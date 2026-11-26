import { prisma } from "@/server/db";
import type { MatchResult } from "@/server/ai/matcher";

/** One scored candidate, ready to render as a match card. */
export interface MatchRow {
  matchId: string;
  /** pending = still being scored, failed = scoring did not work, completed = has a score. */
  status: "pending" | "completed" | "failed";
  /** null until the match is completed. */
  score: number | null;
  error: string | null;
  matchedSkills: string[];
  missingSkills: string[];
  model: string | null;
  shortlisted: boolean;
  updatedAt: Date;
  candidateId: string;
  /** null for LinkedIn candidates. */
  githubId: bigint | null;
  source: "github" | "linkedin" | "cutshort" | "naukri";
  login: string;
  name: string | null;
  avatarUrl: string | null;
  profileUrl: string;
  bio: string | null;
  location: string | null;
  headline: string | null;
  skills: string[];
  experienceYears: number | null;
  /** Contact data for outreach. */
  emails: string[];
  phoneNumbers: string[];
  personalWebsite: string | null;
  otherLinks: string[];
  /** Naukri extras. */
  note: string | null;
  ctc: string | null;
  noticePeriod: string | null;
  /** The resume is stored in the platform (file or text). */
  hasResume: boolean;
}

export interface ListMatchesParams {
  jobId: string;
  minScore: number;
  limit: number;
  offset: number;
}

/**
 * Returns the matches of a job in ONE joined query, in display order:
 * scored candidates first (best score first), then candidates still being scored, then failed ones.
 * `minScore` only hides scored candidates below the limit; unscored ones are always returned.
 */
export async function listMatches(params: ListMatchesParams): Promise<MatchRow[]> {
  const { jobId, minScore, limit, offset } = params;

  return prisma.$queryRaw<MatchRow[]>`
    SELECT
      m."id" AS "matchId",
      m."status",
      m."score",
      m."error",
      m."matchedSkills",
      m."missingSkills",
      m."model",
      m."shortlisted",
      m."updatedAt",
      m."note",
      c."ctc",
      c."noticePeriod",
      (c."resumeData" IS NOT NULL OR c."resumeText" IS NOT NULL) AS "hasResume",
      c."id" AS "candidateId",
      c."githubId",
      c."login",
      c."name",
      c."avatarUrl",
      c."profileUrl",
      c."bio",
      c."location",
      c."source",
      c."headline",
      COALESCE(c."skills", '{}') AS "skills",
      c."experienceYears",
      COALESCE(c."emails", '{}') AS "emails",
      COALESCE(c."phoneNumbers", '{}') AS "phoneNumbers",
      c."personalWebsite",
      COALESCE(c."otherLinks", '{}') AS "otherLinks"
    FROM match_scores m
    JOIN candidates c ON c."id" = m."candidateId"
    WHERE m."jobId" = ${jobId}::uuid
      AND (m."status" <> 'completed' OR m."score" >= ${minScore})
    ORDER BY
      CASE m."status" WHEN 'completed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      m."score" DESC NULLS LAST,
      m."createdAt" ASC,
      m."id" ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

/**
 * Creates one "pending" match per candidate for this job, in a single statement.
 * - New pair: inserted as pending.
 * - Pair that failed or is pending from an older run: reset to pending for this batch.
 * - Pair that is already completed: left alone (no repeated Gemini cost). The shortlist flag is never touched.
 */
export async function createPendingMatches(params: {
  jobId: string;
  batchId: string;
  candidateIds: string[];
}): Promise<void> {
  const { jobId, batchId, candidateIds } = params;
  if (candidateIds.length === 0) return;

  await prisma.$executeRaw`
    INSERT INTO match_scores ("jobId", "candidateId", "batchId", "status", "updatedAt")
    SELECT ${jobId}::uuid, c.id, ${batchId}::uuid, 'pending'::"MatchStatus", now()
    FROM unnest(${candidateIds}::uuid[]) AS c(id)
    ON CONFLICT ("jobId", "candidateId") DO UPDATE SET
      "batchId" = EXCLUDED."batchId",
      "status" = 'pending',
      "error" = NULL,
      "updatedAt" = now()
    WHERE match_scores."status" <> 'completed'
  `;
}

/**
 * Puts every unscored match of the job (failed ones, or pending ones left by a crashed run) into this batch
 * as "pending", so this run scores them again. Completed matches are not touched.
 */
export async function resetUnscoredMatches(
  jobId: string,
  batchId: string,
  options: { includeQuickScores?: boolean } = {},
): Promise<void> {
  // Quick scores (offline fallback) are upgraded to a real AI score when the AI is available again.
  const includeQuick = options.includeQuickScores ?? false;
  await prisma.$executeRaw`
    UPDATE match_scores
    SET "batchId" = ${batchId}::uuid, "status" = 'pending', "error" = NULL, "updatedAt" = now()
    WHERE "jobId" = ${jobId}::uuid
      AND ("status" IN ('failed', 'pending') OR (${includeQuick} AND "status" = 'completed' AND "model" = 'heuristic'))
  `;
}

/** A pending match with the text Gemini needs. */
export interface PendingEvaluation {
  matchId: string;
  candidateId: string;
  profileText: string;
}

/** Pending matches of one batch joined with their candidate's profile text (one query). */
export async function listPendingEvaluations(batchId: string): Promise<PendingEvaluation[]> {
  return prisma.$queryRaw<PendingEvaluation[]>`
    SELECT m."id" AS "matchId", c."id" AS "candidateId", c."profileText"
    FROM match_scores m
    JOIN candidates c ON c."id" = m."candidateId"
    WHERE m."batchId" = ${batchId}::uuid
      AND m."status" = 'pending'
      AND c."profileText" IS NOT NULL
    ORDER BY m."createdAt", m."id"
  `;
}

/** The best free-scored (X-Ray) matches of a batch, best first. Used to pick who deserves an AI re-score. */
export async function listTopFreeScoredMatches(batchId: string, limit: number): Promise<PendingEvaluation[]> {
  return prisma.$queryRaw<PendingEvaluation[]>`
    SELECT m."id" AS "matchId", c."id" AS "candidateId", c."profileText"
    FROM match_scores m
    JOIN candidates c ON c."id" = m."candidateId"
    WHERE m."batchId" = ${batchId}::uuid
      AND m."status" = 'completed'
      AND m."model" = 'xray-heuristic'
      AND c."profileText" IS NOT NULL
    ORDER BY m."score" DESC NULLS LAST, m."id" ASC
    LIMIT ${limit}::int
  `;
}

/** Saves a successful Gemini result. */
export async function markMatchCompleted(matchId: string, result: MatchResult): Promise<void> {
  await prisma.matchScore.update({
    where: { id: matchId },
    data: {
      status: "completed",
      score: result.score,
      matchedSkills: result.matchedSkills,
      missingSkills: result.missingSkills,
      model: result.model,
      error: null,
    },
  });
}

/** Marks only this one match as failed and keeps the error text. */
export async function markMatchFailed(matchId: string, model: string, error: string): Promise<void> {
  await prisma.matchScore.update({
    where: { id: matchId },
    data: { status: "failed", model, error: error.slice(0, 500) },
  });
}

/**
 * Sets the shortlist flag, but only if the match belongs to this job AND the job belongs to this organization.
 * @returns true if a row was updated.
 */
export async function setShortlisted(params: {
  matchId: string;
  jobId: string;
  organizationId: string;
  shortlisted: boolean;
}): Promise<boolean> {
  const { matchId, jobId, organizationId, shortlisted } = params;

  const result = await prisma.matchScore.updateMany({
    where: { id: matchId, jobId, job: { organizationId } },
    data: { shortlisted },
  });
  return result.count > 0;
}
