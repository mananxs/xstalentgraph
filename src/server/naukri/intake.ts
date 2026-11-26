import { ApiError } from "@/server/api/http";
import { NAUKRI_EXT_MODEL } from "@/server/ai/heuristic";
import { prisma } from "@/server/db";
import { MAX_UPLOAD_BYTES, fileToText } from "@/server/files/parse";
import { createLogger } from "@/server/logger";
import type { RecruiterContext } from "@/server/repositories/recruiterRepository";
import { sniffResume, type ResumeKind } from "./resumeFile";
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

  const resumeFields =
    fileBuffer && kind
      ? { resumeData: new Uint8Array(fileBuffer), resumeFileName: fileName, resumeFileType: kind, resumeText, resumeCapturedAt: new Date() }
      : resumeText
        ? { resumeText, resumeCapturedAt: new Date() }
        : {};

  const base = {
    source: "naukri",
    login: key,
    name: candidate.name,
    avatarUrl: candidate.avatarUrl ?? null,
    profileUrl: candidate.profileUrl || "https://resdex.naukri.com/",
    headline: candidate.headline ?? null,
    bio: candidate.summary ?? null,
    location: candidate.location ?? null,
    skills: candidate.skills,
    experienceYears: candidate.experienceYears ?? null,
    emails: candidate.emails,
    phoneNumbers: candidate.phones,
    phone: candidate.phones[0] ?? null,
    phoneSource: candidate.phones[0] ? "naukri" : null,
    ctc: candidate.ctc ?? null,
    noticePeriod: candidate.noticePeriod ?? null,
    profileText: naukriProfileText(payload),
    lastIngestedAt: new Date(),
  };

  const mode = params.mode ?? "card";
  const before = await prisma.candidate.findUnique({ where: { naukriId: key }, select: { id: true, fullProfile: true } });
  const keptFullProfile = mode === "card" && before?.fullProfile === true;
  const select = { id: true, resumeData: true, resumeText: true } as const;
  const saved = keptFullProfile
    ? await prisma.candidate.findUniqueOrThrow({ where: { naukriId: key }, select })
    : await prisma.candidate.upsert({
        where: { naukriId: key },
        create: { ...base, naukriId: key, ...resumeFields, fullProfile: mode === "profile" },
        update: { ...base, ...resumeFields, ...(mode === "profile" ? { fullProfile: true } : {}) },
        select,
      });

  const match = await prisma.matchScore.upsert({
    where: { jobId_candidateId: { jobId: job.id, candidateId: saved.id } },
    create: {
      jobId: job.id,
      candidateId: saved.id,
      status: "completed",
      score: Math.round(analysis.score),
      matchedSkills: analysis.matchedSkills,
      missingSkills: analysis.missingSkills,
      model: NAUKRI_EXT_MODEL,
      note: analysis.reason ?? null,
      shortlisted: true,
    },
    update: {
      status: "completed",
      score: Math.round(analysis.score),
      matchedSkills: analysis.matchedSkills,
      missingSkills: analysis.missingSkills,
      model: NAUKRI_EXT_MODEL,
      note: analysis.reason ?? null,
      shortlisted: true,
      error: null,
    },
    select: { id: true },
  });

  const stored: IntakeResult["resume"] = saved.resumeData ? "file" : saved.resumeText ? "text" : "none";
  if (stored === "none" && !warning) warning = "No resume reached the platform. Open the profile in Naukri and press Save again once the CV has loaded.";
  if (stored === "text" && !warning) warning = "Only the CV text was captured (the file could not be downloaded).";

  return {
    candidateId: saved.id,
    matchId: match.id,
    jobId: job.id,
    jobTitle: job.title,
    created: !before,
    keptFullProfile,
    resume: stored,
    resumeWarning: stored === "file" ? null : warning,
    profilePath: `/candidates/${saved.id}?job=${job.id}`,
  };
}
