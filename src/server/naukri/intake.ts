import { ApiError } from "@/server/api/http";
import { NAUKRI_EXT_MODEL } from "@/server/ai/heuristic";
import { prisma } from "@/server/db";
import { MAX_UPLOAD_BYTES, fileToText } from "@/server/files/parse";
import { createLogger } from "@/server/logger";
import type { RecruiterContext } from "@/server/repositories/recruiterRepository";
import { sniffResume, type ResumeKind } from "./resumeFile";
import { parseCtcLpa, parseNotice } from "@/server/extension/cardParse";
import { ensureRubric, evaluateAndStore, moveStage, resolveCandidate } from "@/server/hunt/store";
import { storeResumeFile } from "@/server/hunt/resumes";
import { findJobInOrganization } from "@/server/repositories/jobRepository";
import { naukriKey, naukriProfileText, type ShortlistPayload } from "./schema";

const log = createLogger("naukri-intake");

export interface IntakeResult {
  candidateId: string;
  matchId: string;
  jobId: string;
  jobTitle: string;
  created: boolean;
  /** A list-card save arrived for a person whose full profile was already saved: the profile was kept untouched. */
  keptFullProfile: boolean;
  /** file = original PDF/DOC stored; text = only the CV text stored; none = no resume reached the platform. */
  resume: "file" | "text" | "none";
  /** Human-readable reason when `resume` is not "file". The extension shows it to the recruiter. */
  resumeWarning: string | null;
  /** Where to open the candidate inside the platform. */
  profilePath: string;
}

async function resolveJob(recruiter: RecruiterContext, job: ShortlistPayload["job"]) {
  if (job.id) {
    const found = await prisma.jobDescription.findFirst({ where: { id: job.id, organizationId: recruiter.organizationId }, select: { id: true, title: true } });
    if (!found) throw new ApiError(404, "That job does not exist in the platform. Pick a job from the list or send its title.");
    return found;
  }
  const title = job.title?.trim();
  if (!title) throw new ApiError(400, "Send job.id or job.title so the candidate is filed under a requirement.");
  const existing = await prisma.jobDescription.findFirst({
    where: { organizationId: recruiter.organizationId, title: { equals: title, mode: "insensitive" } },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.jobDescription.create({
    data: {
      organizationId: recruiter.organizationId,
      createdById: recruiter.id,
      title,
      description: job.description?.trim() || title,
      requiredSkills: job.requiredSkills,
      preferredSkills: job.preferredSkills,
      locations: job.locations,
      experienceYears: job.experienceYears ?? null,
      source: "manual",
    },
    select: { id: true, title: true },
  });
}

/**
 * Saves one shortlisted Naukri candidate with its score and (when it reached us) its resume.
 * Idempotent: saving the same person again for the same job updates the row; a resume that is already stored is
 * never replaced by an empty or invalid one.
 */
export async function saveNaukriShortlist(params: {
  recruiter: RecruiterContext;
  payload: ShortlistPayload;
  resume: { name: string; buffer: Buffer } | null;
  /** card = a Resdex list card (never overwrites a saved full profile) · profile = the opened profile. Default card. */
  mode?: "card" | "profile";
}): Promise<IntakeResult> {
  const { recruiter, payload } = params;
  const job = await resolveJob(recruiter, payload.job);
  const { candidate, analysis } = payload;
  const key = naukriKey(candidate);

  // ---- resume: file first, text second, never a login page ----
  let kind: ResumeKind | null = null;
  let fileName: string | null = null;
  let fileBuffer: Buffer | null = null;
  let resumeText = payload.resumeText?.trim() || null;
  let warning: string | null = null;

  if (params.resume) {
    if (params.resume.buffer.length > MAX_UPLOAD_BYTES) {
      warning = "The resume file is larger than 10 MB, so it was not stored.";
    } else {
      kind = sniffResume(params.resume.buffer, params.resume.name);
      if (kind) {
        fileBuffer = params.resume.buffer;
        fileName = (payload.resumeFileName || params.resume.name).replace(/[^\w.\- ]+/g, "").slice(0, 200) || `resume.${kind}`;
        if (!resumeText) {
          try {
            resumeText = (await fileToText(`resume.${kind}`, fileBuffer)).slice(0, 200_000) || null;
          } catch (error) {
            log.warn({ err: error }, "could not read text from the stored resume");
          }
        }
      } else {
        warning = "The downloaded file was not a PDF/DOC (Naukri probably returned a login page), so it was not stored.";
      }
    }
  }

  const mode = params.mode ?? "card";
  const org = recruiter.organizationId;
  const company = / at (.+)$/i.exec(candidate.headline ?? "")?.[1] ?? null;
  const resolved = await resolveCandidate({
    organizationId: org,
    source: "naukri",
    externalId: key,
    name: candidate.name,
    emails: candidate.emails,
    phones: candidate.phones,
    profileUrl: candidate.profileUrl && !/^https?:\/\/[^/]+\/?$/.test(candidate.profileUrl) ? candidate.profileUrl : null,
    company,
    expYears: candidate.experienceYears ?? null,
    headline: candidate.headline ?? null,
    data: { ctc: candidate.ctc ?? null, noticePeriod: candidate.noticePeriod ?? null, location: candidate.location ?? null },
  });
  const before = await prisma.candidate.findUniqueOrThrow({ where: { id: resolved.candidateId }, select: { id: true, fullProfile: true, primarySource: true, naukriId: true, skills: true, emails: true, phoneNumbers: true, headline: true, location: true, bio: true } });
  const keptFullProfile = mode === "card" && before.fullProfile === true;

  if (!keptFullProfile) {
    const own = before.primarySource === "naukri";
    const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
    await prisma.candidate.update({
      where: { id: before.id },
      data: {
        name: own ? candidate.name : undefined,
        avatarUrl: candidate.avatarUrl ?? undefined,
        headline: own ? (candidate.headline ?? undefined) : (before.headline ?? candidate.headline ?? undefined),
        bio: own ? (candidate.summary ?? undefined) : (before.bio ?? candidate.summary ?? undefined),
        location: own ? (candidate.location ?? undefined) : (before.location ?? candidate.location ?? undefined),
        skills: own ? candidate.skills : union(before.skills, candidate.skills),
        experienceYears: candidate.experienceYears ?? undefined,
        emails: union(before.emails, candidate.emails),
        phoneNumbers: union(before.phoneNumbers, candidate.phones),
        phone: candidate.phones[0] ?? undefined,
        phoneSource: candidate.phones[0] ? "naukri" : undefined,
        ctc: candidate.ctc ?? undefined,
        noticePeriod: candidate.noticePeriod ?? undefined,
        profileText: naukriProfileText(payload),
        lastIngestedAt: new Date(),
        naukriId: before.naukriId ?? `${org.slice(0, 8)}:${key}`,
        ...(mode === "profile" ? { fullProfile: true } : {}),
        ...(resumeText && !fileBuffer ? { resumeText, resumeCapturedAt: new Date() } : {}),
      },
    });
  }
  if (fileBuffer && kind) {
    await storeResumeFile({ organizationId: org, candidateId: before.id, buffer: fileBuffer, fileName: fileName ?? `resume.${kind}`, fileType: kind, text: resumeText, origin: "naukri", actorId: recruiter.id });
  }
  const saved = await prisma.candidate.findUniqueOrThrow({ where: { id: before.id }, select: { id: true, resumeData: true, resumeText: true } });

  // The standard 7-dimension evaluation under the job's current rubric (history is kept; overrides and stage are untouched).
  const jobRow = await findJobInOrganization(job.id, org);
  let evaluated: { matchId: string } | null = null;
  if (jobRow) {
    const rubric = await ensureRubric(jobRow, recruiter.id);
    const ctcLpa = candidate.ctc ? parseCtcLpa(candidate.ctc) : -1;
    const notice = candidate.noticePeriod ? parseNotice(`Notice period: ${candidate.noticePeriod}`).days : -1;
    const row = await prisma.candidate.findUniqueOrThrow({ where: { id: saved.id }, select: { skills: true, resumeText: true } });
    evaluated = await evaluateAndStore({
      job: jobRow,
      rubric,
      candidateId: saved.id,
      facts: {
        name: candidate.name,
        headline: candidate.headline ?? undefined,
        skills: candidate.skills.length ? candidate.skills : row.skills,
        expYears: candidate.experienceYears ?? null,
        currentCtcLpa: ctcLpa >= 0 ? ctcLpa : null,
        expectedCtcLpa: null,
        noticeDays: notice >= 0 ? notice : null,
        location: candidate.location ?? undefined,
        text: [candidate.summary, row.resumeText, naukriProfileText(payload)].filter(Boolean).join("\n").slice(0, 20_000),
      },
    });
  }

  // Saving from Naukri = shortlisting. Earlier or rejected stages move to Shortlisted; later stages stay where they are.
  const match = await prisma.matchScore.upsert({
    where: { jobId_candidateId: { jobId: job.id, candidateId: saved.id } },
    create: { jobId: job.id, candidateId: saved.id, status: "completed", score: Math.round(analysis.score), matchedSkills: analysis.matchedSkills, missingSkills: analysis.missingSkills, model: NAUKRI_EXT_MODEL, note: analysis.reason ?? null, shortlisted: true, stage: "shortlisted" },
    update: { shortlisted: true },
    select: { id: true, stage: true },
  });
  if (["new", "sourced", "screening", "rejected"].includes(match.stage)) {
    await moveStage({ organizationId: org, matchId: match.id, to: "shortlisted", actorId: recruiter.id });
  }
  void evaluated;

  const stored: IntakeResult["resume"] = saved.resumeData ? "file" : saved.resumeText ? "text" : "none";
  if (stored === "none" && !warning) warning = "No resume reached the platform. Open the profile in Naukri and press Save again once the CV has loaded.";
  if (stored === "text" && !warning) warning = "Only the CV text was captured (the file could not be downloaded).";

  return {
    candidateId: saved.id,
    matchId: match.id,
    jobId: job.id,
    jobTitle: job.title,
    created: resolved.created,
    keptFullProfile,
    resume: stored,
    resumeWarning: stored === "file" ? null : warning,
    profilePath: `/candidates/${saved.id}?job=${job.id}`,
  };
}
