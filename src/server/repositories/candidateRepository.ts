import { prisma } from "@/server/db";
import type { CandidateProfile } from "@/server/github/profileMapper";
import type { LinkedInProfile } from "@/server/linkedin/profileMapper";
import { toVectorLiteral } from "@/server/ai/embeddings";

/** A GitHub profile plus the text that will be embedded and scored. */
export interface CandidateUpsertInput {
  profile: CandidateProfile;
  profileText: string;
}

const UPSERT_CHUNK_SIZE = 100;

/**
 * Inserts or updates candidates (INSERT ... ON CONFLICT on githubId), 100 rows per statement.
 * If the profile text changed, the old embedding is cleared so it will be embedded again.
 * @returns Map of githubId (as string) to the candidate's database id.
 */
export async function upsertCandidates(inputs: CandidateUpsertInput[]): Promise<Map<string, string>> {
  const idByGithubId = new Map<string, string>();

  for (let start = 0; start < inputs.length; start += UPSERT_CHUNK_SIZE) {
    const rows = inputs.slice(start, start + UPSERT_CHUNK_SIZE).map(({ profile, profileText }) => ({
      githubId: profile.githubId.toString(), // string: JSON cannot carry BigInt
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      profileUrl: profile.profileUrl,
      bio: profile.bio,
      location: profile.location,
      githubCreatedAt: profile.githubCreatedAt.toISOString(),
      yearsActive: profile.yearsActive,
      topLanguages: profile.topLanguages,
      topics: profile.topics,
      profileText,
    }));

    const saved = await prisma.$queryRaw<Array<{ id: string; githubId: bigint }>>`
      INSERT INTO candidates (
        "githubId", "login", "name", "avatarUrl", "profileUrl", "bio", "location",
        "githubCreatedAt", "yearsActive", "topLanguages", "topics", "profileText",
        "lastIngestedAt", "updatedAt"
      )
      SELECT
        r."githubId", r."login", r."name", r."avatarUrl", r."profileUrl", r."bio", r."location",
        r."githubCreatedAt", r."yearsActive", r."topLanguages", r."topics", r."profileText",
        now(), now()
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(
        "githubId" bigint, "login" text, "name" text, "avatarUrl" text, "profileUrl" text,
        "bio" text, "location" text, "githubCreatedAt" timestamptz, "yearsActive" double precision,
        "topLanguages" jsonb, "topics" text[], "profileText" text
      )
      ON CONFLICT ("githubId") DO UPDATE SET
        "login" = EXCLUDED."login",
        "name" = EXCLUDED."name",
        "avatarUrl" = EXCLUDED."avatarUrl",
        "profileUrl" = EXCLUDED."profileUrl",
        "bio" = EXCLUDED."bio",
        "location" = EXCLUDED."location",
        "githubCreatedAt" = EXCLUDED."githubCreatedAt",
        "yearsActive" = EXCLUDED."yearsActive",
        "topLanguages" = EXCLUDED."topLanguages",
        "topics" = EXCLUDED."topics",
        "embedding" = CASE
          WHEN candidates."profileText" IS DISTINCT FROM EXCLUDED."profileText" THEN NULL
          ELSE candidates."embedding"
        END,
        "profileText" = EXCLUDED."profileText",
        "lastIngestedAt" = now(),
        "updatedAt" = now()
      RETURNING "id", "githubId"
    `;

    for (const row of saved) idByGithubId.set(row.githubId.toString(), row.id);
  }

  return idByGithubId;
}

/** A LinkedIn profile plus the text that will be embedded and scored. */
export interface LinkedInUpsertInput {
  profile: LinkedInProfile;
  profileText: string;
}

/**
 * Inserts or updates LinkedIn candidates (ON CONFLICT on linkedinId).
 * Same rules as upsertCandidates: a changed profileText clears the embedding. Contact data is stored here for
 * recruiter outreach only; it is never part of profileText, so it never reaches the AI.
 * @returns Map of linkedinId to the candidate's database id.
 */
export async function upsertLinkedInCandidates(inputs: LinkedInUpsertInput[]): Promise<Map<string, string>> {
  const idByLinkedinId = new Map<string, string>();

  for (let start = 0; start < inputs.length; start += UPSERT_CHUNK_SIZE) {
    const rows = inputs.slice(start, start + UPSERT_CHUNK_SIZE).map(({ profile, profileText }) => ({
      linkedinId: profile.linkedinId,
      name: profile.fullName,
      avatarUrl: profile.avatarUrl,
      profileUrl: profile.profileUrl,
      headline: profile.headline,
      bio: profile.summary,
      location: profile.location,
      skills: profile.skills,
      experienceYears: profile.experienceYears,
      emails: profile.emails,
      phoneNumbers: profile.phoneNumbers,
      personalWebsite: profile.personalWebsite,
      otherLinks: profile.otherLinks,
      profileText,
    }));

    const saved = await prisma.$queryRaw<Array<{ id: string; linkedinId: string }>>`
      INSERT INTO candidates (
        "source", "linkedinId", "login", "name", "avatarUrl", "profileUrl", "headline", "bio", "location",
        "skills", "experienceYears", "emails", "phoneNumbers", "personalWebsite", "otherLinks", "profileText",
        "lastIngestedAt", "updatedAt"
      )
      SELECT
        'linkedin', r."linkedinId", r."linkedinId", r."name", r."avatarUrl", r."profileUrl", r."headline", r."bio", r."location",
        r."skills", r."experienceYears", r."emails", r."phoneNumbers", r."personalWebsite", r."otherLinks", r."profileText",
        now(), now()
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(
        "linkedinId" text, "name" text, "avatarUrl" text, "profileUrl" text, "headline" text, "bio" text,
        "location" text, "skills" text[], "experienceYears" double precision, "emails" text[],
        "phoneNumbers" text[], "personalWebsite" text, "otherLinks" text[], "profileText" text
      )
      ON CONFLICT ("linkedinId") DO UPDATE SET
        "name" = EXCLUDED."name",
        "avatarUrl" = EXCLUDED."avatarUrl",
        "profileUrl" = EXCLUDED."profileUrl",
        "headline" = EXCLUDED."headline",
        "bio" = EXCLUDED."bio",
        "location" = EXCLUDED."location",
        "skills" = EXCLUDED."skills",
        "experienceYears" = EXCLUDED."experienceYears",
        "emails" = EXCLUDED."emails",
        "phoneNumbers" = EXCLUDED."phoneNumbers",
        "personalWebsite" = EXCLUDED."personalWebsite",
        "otherLinks" = EXCLUDED."otherLinks",
        "embedding" = CASE
          WHEN candidates."profileText" IS DISTINCT FROM EXCLUDED."profileText" THEN NULL
          ELSE candidates."embedding"
        END,
        "profileText" = EXCLUDED."profileText",
        "lastIngestedAt" = now(),
        "updatedAt" = now()
      RETURNING "id", "linkedinId"
    `;

    for (const row of saved) idByLinkedinId.set(row.linkedinId, row.id);
  }

  return idByLinkedinId;
}

/** A candidate known from a Google X-Ray result: LinkedIn URL is the only required field. */
export interface SerpUpsertInput {
  linkedinId: string;
  linkedinUrl: string;
  name: string | null;
  headline: string | null;
  location: string | null;
  /** Cleaned profile text (no contact data), see buildSerpProfileText. */
  profileText: string;
  /** Indian mobile found by the snippet regex ("+91..."), or null. */
  phone: string | null;
  /** Short readable summary shown on the card. */
  bio?: string | null;
}

export interface SerpUpsertRow {
  id: string;
  linkedinId: string;
  /** The phone stored for this candidate after the upsert (may come from an earlier run or enrichment). */
  phone: string | null;
}

/**
 * Inserts or updates candidates found by X-Ray search (ON CONFLICT on linkedinId). Only the LinkedIn URL is needed:
 * name, headline, location and phone are all optional, and no email is required or stored.
 * Existing data is never erased by a thinner result: a null name/headline/location/phone keeps the stored value.
 */
export async function upsertSerpCandidates(inputs: SerpUpsertInput[]): Promise<SerpUpsertRow[]> {
  const out: SerpUpsertRow[] = [];

  for (let start = 0; start < inputs.length; start += UPSERT_CHUNK_SIZE) {
    const rows = inputs.slice(start, start + UPSERT_CHUNK_SIZE).map((input) => ({
      linkedinId: input.linkedinId,
      name: input.name,
      profileUrl: input.linkedinUrl,
      headline: input.headline,
      bio: input.bio ?? null,
      location: input.location,
      phone: input.phone,
      phoneSource: input.phone ? "serp_regex" : null,
      phoneNumbers: input.phone ? [input.phone] : [],
      profileText: input.profileText,
    }));

    const saved = await prisma.$queryRaw<SerpUpsertRow[]>`
      INSERT INTO candidates (
        "source", "linkedinId", "login", "name", "profileUrl", "headline", "bio", "location",
        "phone", "phoneSource", "phoneNumbers", "profileText", "lastIngestedAt", "updatedAt"
      )
      SELECT
        'linkedin', r."linkedinId", r."linkedinId", r."name", r."profileUrl", r."headline", r."bio", r."location",
        r."phone", r."phoneSource", r."phoneNumbers", r."profileText", now(), now()
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(
        "linkedinId" text, "name" text, "profileUrl" text, "headline" text, "bio" text, "location" text,
        "phone" text, "phoneSource" text, "phoneNumbers" text[], "profileText" text
      )
      ON CONFLICT ("linkedinId") DO UPDATE SET
        "name" = COALESCE(EXCLUDED."name", candidates."name"),
        "headline" = COALESCE(EXCLUDED."headline", candidates."headline"),
        "bio" = COALESCE(EXCLUDED."bio", candidates."bio"),
        "location" = COALESCE(EXCLUDED."location", candidates."location"),
        "phoneSource" = CASE WHEN candidates."phone" IS NULL AND EXCLUDED."phone" IS NOT NULL THEN EXCLUDED."phoneSource" ELSE candidates."phoneSource" END,
        "phone" = COALESCE(candidates."phone", EXCLUDED."phone"),
        "phoneNumbers" = ARRAY(SELECT DISTINCT unnest(COALESCE(candidates."phoneNumbers", '{}') || EXCLUDED."phoneNumbers")),
        "embedding" = CASE
          WHEN candidates."profileText" IS NULL OR length(EXCLUDED."profileText") >= length(candidates."profileText")
            THEN CASE WHEN candidates."profileText" IS DISTINCT FROM EXCLUDED."profileText" THEN NULL ELSE candidates."embedding" END
          ELSE candidates."embedding"
        END,
        "profileText" = CASE
          WHEN candidates."profileText" IS NULL OR length(EXCLUDED."profileText") >= length(candidates."profileText")
            THEN EXCLUDED."profileText"
          ELSE candidates."profileText"
        END,
        "lastIngestedAt" = now(),
        "updatedAt" = now()
      RETURNING "id", "linkedinId", "phone"
    `;
    out.push(...saved);
  }

  return out;
}

/** A candidate found through the Cutshort search API (no name or contact until unlocked). */
export interface CutshortUpsertInput {
  cutshortId: string;
  headline: string | null;
  bio?: string | null;
  location: string | null;
  experienceYears: number | null;
  profileText: string;
}

/** Inserts or updates Cutshort candidates (ON CONFLICT on cutshortId). Returns cutshortId -> database id. */
export async function upsertCutshortCandidates(inputs: CutshortUpsertInput[]): Promise<Map<string, string>> {
  const idByCutshortId = new Map<string, string>();

  for (let start = 0; start < inputs.length; start += UPSERT_CHUNK_SIZE) {
    const rows = inputs.slice(start, start + UPSERT_CHUNK_SIZE);
    const saved = await prisma.$queryRaw<Array<{ id: string; cutshortId: string }>>`
      INSERT INTO candidates (
        "source", "cutshortId", "login", "profileUrl", "headline", "bio", "location", "experienceYears", "profileText",
        "lastIngestedAt", "updatedAt"
      )
      SELECT
        'cutshort', r."cutshortId", r."cutshortId", 'https://cutshort.io', r."headline", r."bio", r."location", r."experienceYears", r."profileText",
        now(), now()
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(
        "cutshortId" text, "headline" text, "bio" text, "location" text, "experienceYears" double precision, "profileText" text
      )
      ON CONFLICT ("cutshortId") DO UPDATE SET
        "headline" = COALESCE(EXCLUDED."headline", candidates."headline"),
        "bio" = COALESCE(EXCLUDED."bio", candidates."bio"),
        "location" = COALESCE(EXCLUDED."location", candidates."location"),
        "experienceYears" = COALESCE(EXCLUDED."experienceYears", candidates."experienceYears"),
        "embedding" = CASE WHEN candidates."profileText" IS DISTINCT FROM EXCLUDED."profileText" THEN NULL ELSE candidates."embedding" END,
        "profileText" = EXCLUDED."profileText",
        "lastIngestedAt" = now(),
        "updatedAt" = now()
      RETURNING "id", "cutshortId"
    `;
    for (const row of saved) idByCutshortId.set(row.cutshortId, row.id);
  }
  return idByCutshortId;
}

/** Stores the contact details Cutshort returned after an unlock. Never overwrites an existing phone. */
export async function saveCutshortContact(
  candidateId: string,
  contact: { name: string | null; email: string | null; phone: string | null },
): Promise<void> {
  const phones = contact.phone ? [contact.phone] : [];
  const emails = contact.email ? [contact.email.toLowerCase()] : [];
  await prisma.$executeRaw`
    UPDATE candidates
    SET "name" = COALESCE(${contact.name}::text, "name"),
        "phoneSource" = CASE WHEN "phone" IS NULL AND ${contact.phone}::text IS NOT NULL THEN 'cutshort' ELSE "phoneSource" END,
        "phone" = COALESCE("phone", ${contact.phone}::text),
        "phoneNumbers" = ARRAY(SELECT DISTINCT unnest(COALESCE("phoneNumbers", '{}') || ${phones}::text[])),
        "emails" = ARRAY(SELECT DISTINCT unnest(COALESCE("emails", '{}') || ${emails}::text[])),
        "updatedAt" = now()
    WHERE "id" = ${candidateId}::uuid
  `;
}

/**
 * The best-scored Cutshort candidates of a JOB that still have no phone: the only ones worth an unlock credit.
 * By job, not by batch: a candidate scored in an earlier run belongs to that run's batch but is just as worth revealing.
 */
export async function listCutshortUnlockCandidates(
  jobId: string,
  minScore: number,
  limit: number,
): Promise<Array<{ candidateId: string; cutshortId: string; score: number }>> {
  return prisma.$queryRaw<Array<{ candidateId: string; cutshortId: string; score: number }>>`
    SELECT c."id" AS "candidateId", c."cutshortId", m."score"
    FROM match_scores m
    JOIN candidates c ON c."id" = m."candidateId"
    WHERE m."jobId" = ${jobId}::uuid
      AND m."status" = 'completed'
      AND m."score" >= ${minScore}::int
      AND c."source" = 'cutshort'
      AND c."phone" IS NULL
      AND c."cutshortId" IS NOT NULL
    ORDER BY m."score" DESC, m."id" ASC
    LIMIT ${limit}::int
  `;
}

/** The Cutshort id behind a match of this job (for the "Reveal contact" button). null when it is not a Cutshort candidate. */
export async function findCutshortCandidateForMatch(matchId: string, jobId: string): Promise<{ candidateId: string; cutshortId: string } | null> {
  const row = await prisma.matchScore.findFirst({
    where: { id: matchId, jobId },
    select: { candidate: { select: { id: true, cutshortId: true } } },
  });
  return row?.candidate.cutshortId ? { candidateId: row.candidate.id, cutshortId: row.candidate.cutshortId } : null;
}

/** Saves a phone found by paid enrichment. Never overwrites a number that is already stored. */
export async function saveEnrichedPhone(candidateId: string, phone: string, provider: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE candidates
    SET "phone" = COALESCE("phone", ${phone}),
        "phoneSource" = CASE WHEN "phone" IS NULL THEN ${`enrichment:${provider}`} ELSE "phoneSource" END,
        "phoneNumbers" = ARRAY(SELECT DISTINCT unnest(COALESCE("phoneNumbers", '{}') || ARRAY[${phone}]::text[])),
        "updatedAt" = now()
    WHERE "id" = ${candidateId}::uuid
  `;
}

/** A candidate that still needs an embedding. */
export interface CandidateToEmbed {
  id: string;
  profileText: string;
}

/** Finds candidates (from the given ids) that have profile text but no embedding yet. One query. */
export async function findCandidatesMissingEmbedding(candidateIds: string[]): Promise<CandidateToEmbed[]> {
  if (candidateIds.length === 0) return [];

  return prisma.$queryRaw<CandidateToEmbed[]>`
    SELECT "id", "profileText"
    FROM candidates
    WHERE "id" = ANY(${candidateIds}::uuid[])
      AND "embedding" IS NULL
      AND "profileText" IS NOT NULL
  `;
}

/** Writes one embedding into the pgvector column. */
export async function saveCandidateEmbedding(candidateId: string, vector: number[]): Promise<void> {
  await prisma.$executeRaw`
    UPDATE candidates
    SET "embedding" = ${toVectorLiteral(vector)}::vector, "updatedAt" = now()
    WHERE "id" = ${candidateId}::uuid
  `;
}
