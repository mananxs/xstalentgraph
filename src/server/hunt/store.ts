import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { JobDetails } from "@/server/repositories/jobRepository";
import { scoringJob } from "@/server/extension/scoring";
import { evaluateCandidate, type CandidateFacts, type EvaluationResult } from "./evaluate";
import { factsFromCandidateRow } from "./facts";
import { findIdentity, normEmail, normPhone, type IdentityProbe, type MatchReason } from "./identity";
import { defaultRubric, sanitizeRubric, type RubricData } from "./rubric";
import { isShortlistedStage, isStage, STAGES, type Stage } from "./stages";

export const ENGINE = "xs-hunt-standard";

type Tx = Prisma.TransactionClient | typeof prisma;

export interface ActiveRubric {
  id: string;
  version: number;
  data: RubricData;
}

const asData = (dimensions: unknown, custom: unknown): RubricData => ({ dimensions: dimensions as RubricData["dimensions"], custom: (custom ?? []) as RubricData["custom"] });

/** The job's current rubric. The first call creates version 1 from what the JD says. */
export async function ensureRubric(job: JobDetails, actorId?: string | null): Promise<ActiveRubric> {
  const latest = await prisma.evaluationRubric.findFirst({ where: { jobId: job.id }, orderBy: { version: "desc" } });
  if (latest) return { id: latest.id, version: latest.version, data: asData(latest.dimensions, latest.custom) };
  const raw = await prisma.jobDescription.findUnique({ where: { id: job.id }, select: { rawText: true } });
  const data = defaultRubric({ ...job, rawText: raw?.rawText ?? null });
  try {
    const created = await prisma.evaluationRubric.create({ data: { jobId: job.id, version: 1, dimensions: data.dimensions as unknown as Prisma.InputJsonValue, custom: data.custom as unknown as Prisma.InputJsonValue, notes: "Created from the job description", createdById: actorId ?? null } });
    return { id: created.id, version: 1, data };
  } catch {
    // Two requests created version 1 at once: the other one won.
    const again = await prisma.evaluationRubric.findFirstOrThrow({ where: { jobId: job.id }, orderBy: { version: "desc" } });
    return { id: again.id, version: again.version, data: asData(again.dimensions, again.custom) };
  }
}

export async function listRubricVersions(jobId: string) {
  const rows = await prisma.evaluationRubric.findMany({ where: { jobId }, orderBy: { version: "desc" }, take: 50, select: { id: true, version: true, notes: true, createdAt: true, createdById: true } });
  return rows;
}

/** Saves a NEW version of the rubric (older versions and their evaluations are kept). */
export async function saveRubric(job: JobDetails, input: unknown, actorId: string, notes?: string): Promise<ActiveRubric> {
  const current = await ensureRubric(job, actorId);
  const data = sanitizeRubric(input, current.data);
  const created = await prisma.evaluationRubric.create({
    data: { jobId: job.id, version: current.version + 1, dimensions: data.dimensions as unknown as Prisma.InputJsonValue, custom: data.custom as unknown as Prisma.InputJsonValue, notes: notes?.slice(0, 300) ?? null, createdById: actorId },
  });
  await recordEvent({ organizationId: job.organizationId, jobId: job.id, kind: "rubric", actorId, data: { version: created.version } });
  return { id: created.id, version: created.version, data };
}

export async function recordEvent(e: { organizationId: string; jobId?: string | null; candidateId?: string | null; matchId?: string | null; kind: string; fromStage?: string | null; toStage?: string | null; actorId?: string | null; data?: Record<string, unknown> }, tx: Tx = prisma) {
  await tx.pipelineEvent.create({
    data: { organizationId: e.organizationId, jobId: e.jobId ?? null, candidateId: e.candidateId ?? null, matchId: e.matchId ?? null, kind: e.kind, fromStage: e.fromStage ?? null, toStage: e.toStage ?? null, actorId: e.actorId ?? null, data: (e.data ?? {}) as Prisma.InputJsonValue },
  });
}

const noteOf = (r: EvaluationResult) => (r.concerns[0] ? `${r.strengths[0] ?? ""}${r.strengths[0] ? " | " : ""}Concern: ${r.concerns[0]}` : (r.strengths[0] ?? r.missingInfo.length ? `Missing: ${r.missingInfo.slice(0, 3).join(", ")}` : null)) ?? null;

/**
 * Evaluates one candidate for one job under the given rubric, stores the evaluation in the history, and refreshes the job's match row
 * (score, tier, matched/missing skills). A recruiter override and the stage are never touched.
 */
export async function evaluateAndStore(p: { job: JobDetails; rubric: ActiveRubric; candidateId: string; facts: CandidateFacts; engine?: string }): Promise<{ evaluationId: string; result: EvaluationResult; matchId: string }> {
  const result = evaluateCandidate(scoringJob(p.job), p.rubric.data, p.facts);
  const evaluation = await prisma.candidateEvaluation.create({
    data: {
      organizationId: p.job.organizationId, jobId: p.job.id, candidateId: p.candidateId, rubricId: p.rubric.id, rubricVersion: p.rubric.version,
      total: result.total, tier: result.tier, evidenceCoverage: result.evidenceCoverage,
      dimensions: { ...result.dimensions, _meta: { band: result.band, mustHaveCoverage: result.mustHaveCoverage } } as unknown as Prisma.InputJsonValue,
      strengths: result.strengths, concerns: result.concerns, missingInfo: result.missingInfo, engine: p.engine ?? ENGINE,
    },
    select: { id: true },
  });
  const data = { status: "completed" as const, score: result.total, tier: result.tier, rubricVersion: p.rubric.version, latestEvaluationId: evaluation.id, matchedSkills: result.matchedSkills, missingSkills: result.missingSkills, model: p.engine ?? ENGINE, note: noteOf(result), error: null };
  const match = await prisma.matchScore.upsert({
    where: { jobId_candidateId: { jobId: p.job.id, candidateId: p.candidateId } },
    create: { jobId: p.job.id, candidateId: p.candidateId, stage: "sourced", ...data },
    update: data,
    select: { id: true, stage: true },
  });
  if (match.stage === "new") await prisma.matchScore.update({ where: { id: match.id }, data: { stage: "sourced", stageChangedAt: new Date() } });
  return { evaluationId: evaluation.id, result, matchId: match.id };
}

/** Re-evaluates every candidate of a job under the CURRENT rubric (used after the rubric changes, when the recruiter asks for it). */
export async function rescoreJob(job: JobDetails, actorId: string | null, limit = 1500): Promise<{ rescored: number }> {
  const rubric = await ensureRubric(job, actorId);
  const matches = await prisma.matchScore.findMany({
    where: { jobId: job.id },
    take: limit,
    select: { candidate: { select: { id: true, name: true, headline: true, skills: true, experienceYears: true, ctc: true, noticePeriod: true, location: true, bio: true, profileText: true, resumeText: true } } },
  });
  let rescored = 0;
  for (const { candidate } of matches) {
    const captured = await prisma.capturedCandidate.findFirst({ where: { jobId: job.id, candidateId: candidate.id }, orderBy: { capturedAt: "desc" }, select: { rawText: true, parsed: true } });
    const base = factsFromCandidateRow(candidate);
    const parsed = (captured?.parsed ?? null) as Partial<CandidateFacts> & { noticeDays?: number; education?: string; prefLocations?: string; expectedCtcLpa?: number } | null;
    const facts: CandidateFacts = captured
      ? { ...base, text: `${captured.rawText}\n${base.text}`.slice(0, 20_000), education: parsed?.education || undefined, prefLocations: parsed?.prefLocations || undefined, expectedCtcLpa: typeof parsed?.expectedCtcLpa === "number" && parsed.expectedCtcLpa >= 0 ? parsed.expectedCtcLpa : null }
      : base;
    await evaluateAndStore({ job, rubric, candidateId: candidate.id, facts });
    rescored += 1;
  }
  await recordEvent({ organizationId: job.organizationId, jobId: job.id, kind: "rescore", actorId, data: { rubricVersion: rubric.version, rescored } });
  return { rescored };
}

/** Moves a match to another stage. Rejection needs a reason. Logs the change; keeps the legacy `shortlisted` flag in step. */
export async function moveStage(p: { organizationId: string; matchId: string; to: string; actorId: string; reason?: string | null }): Promise<{ from: string; to: Stage }> {
  if (!isStage(p.to)) throw new Error(`Unknown stage "${p.to}". Use one of: ${STAGES.join(", ")}`);
  if (p.to === "rejected" && !p.reason?.trim()) throw new Error("A rejection needs a reason.");
  const match = await prisma.matchScore.findFirst({ where: { id: p.matchId, job: { organizationId: p.organizationId } }, select: { id: true, stage: true, jobId: true, candidateId: true } });
  if (!match) throw new Error("Candidate not found in this organization.");
  if (match.stage === p.to) return { from: match.stage, to: p.to };
  await prisma.$transaction(async (tx) => {
    await tx.matchScore.update({ where: { id: match.id }, data: { stage: p.to, stageChangedAt: new Date(), shortlisted: isShortlistedStage(p.to), rejectionReason: p.to === "rejected" ? p.reason!.trim().slice(0, 500) : null } });
    await recordEvent({ organizationId: p.organizationId, jobId: match.jobId, candidateId: match.candidateId, matchId: match.id, kind: "stage", fromStage: match.stage, toStage: p.to, actorId: p.actorId, data: p.reason ? { reason: p.reason.slice(0, 500) } : {} }, tx);
  });
  return { from: match.stage, to: p.to };
}

// ------------------------------------------------------------------------------------------------ identity (database)

export interface ResolveInput extends IdentityProbe {
  organizationId: string;
  source: string;
  externalId: string;
  headline?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Finds or creates the ONE Candidate for a person and records which source saw them. Returns the candidate id and why it matched.
 */
export async function resolveCandidate(input: ResolveInput, db: Tx = prisma): Promise<{ candidateId: string; created: boolean; matchedBy: MatchReason | "source_id" | null; merged: boolean }> {
  const org = input.organizationId;
  const existingSource = await db.candidateSource.findUnique({ where: { organizationId_source_externalId: { organizationId: org, source: input.source, externalId: input.externalId } }, select: { candidateId: true } });
  let candidateId = existingSource?.candidateId ?? null;
  let matchedBy: MatchReason | "source_id" | null = existingSource ? "source_id" : null;

  if (!candidateId) {
    // Narrow the pool in SQL (same org, shares an identifier), then decide with the pure matcher.
    const emails = (input.emails ?? []).map(normEmail);
    const phones = (input.phones ?? []).map(normPhone).filter((p): p is string => p !== null);
    const or: Prisma.CandidateWhereInput[] = [];
    if (emails.length) or.push({ emails: { hasSome: emails } });
    if (input.profileUrl) or.push({ profileUrl: input.profileUrl });
    if (input.name && input.company) or.push({ name: { equals: input.name, mode: "insensitive" } });
    const pool = or.length ? await db.candidate.findMany({ where: { organizationId: org, OR: or }, take: 50, select: { id: true, name: true, emails: true, phoneNumbers: true, phone: true, profileUrl: true, headline: true, experienceYears: true } }) : [];
    const phonePool = phones.length ? await db.candidate.findMany({ where: { organizationId: org, OR: phones.map((p) => ({ phoneNumbers: { has: `+91${p}` } })) }, take: 20, select: { id: true, name: true, emails: true, phoneNumbers: true, phone: true, profileUrl: true, headline: true, experienceYears: true } }) : [];
    const known = [...pool, ...phonePool].map((c) => ({ id: c.id, name: c.name, emails: c.emails, phones: [...c.phoneNumbers, ...(c.phone ? [c.phone] : [])], profileUrl: c.profileUrl, company: / at (.+)$/i.exec(c.headline ?? "")?.[1] ?? null, expYears: c.experienceYears }));
    const found = findIdentity(known, input);
    if (found) {
      candidateId = found.id;
      matchedBy = found.reason;
    }
  }

  const created = candidateId === null;
  const now = new Date();
  if (!candidateId) {
    const row = await db.candidate.create({
      data: { organizationId: org, source: input.source, primarySource: input.source, sources: [input.source], login: input.externalId, name: input.name ?? null, profileUrl: input.profileUrl ?? "", headline: input.headline ?? null, emails: input.emails ?? [], phoneNumbers: input.phones ?? [] },
      select: { id: true },
    });
    candidateId = row.id;
  }
  const had = created ? [] : ((await db.candidate.findUnique({ where: { id: candidateId }, select: { sources: true } }))?.sources ?? []);
  const merged = !created && !had.includes(input.source);
  if (merged) await db.candidate.update({ where: { id: candidateId }, data: { sources: [...had, input.source] } });
  await db.candidateSource.upsert({
    where: { organizationId_source_externalId: { organizationId: org, source: input.source, externalId: input.externalId } },
    create: { organizationId: org, candidateId, source: input.source, externalId: input.externalId, profileUrl: input.profileUrl ?? null, data: (input.data ?? {}) as Prisma.InputJsonValue },
    update: { lastSeenAt: now, profileUrl: input.profileUrl ?? undefined, data: (input.data ?? {}) as Prisma.InputJsonValue },
  });
  return { candidateId, created, matchedBy, merged };
}
