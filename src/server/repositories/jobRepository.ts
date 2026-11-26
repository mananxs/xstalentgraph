import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

const jobSelect = {
  id: true,
  organizationId: true,
  title: true,
  description: true,
  requiredSkills: true,
  preferredSkills: true,
  languages: true,
  locations: true,
  remoteAllowed: true,
  technologies: true,
  handsOn: true,
  experienceYears: true,
  seniority: true,
  workMode: true,
  employmentType: true,
  source: true,
  sourceFileName: true,
  createdAt: true,
} satisfies Prisma.JobDescriptionSelect;

/** A job with all fields the ingestion and matching code needs. */
export type JobDetails = Prisma.JobDescriptionGetPayload<{ select: typeof jobSelect }>;

/**
 * Loads one job, but only if it belongs to the given organization.
 * Returning null for both "missing" and "someone else's" avoids leaking which ids exist.
 */
export async function findJobInOrganization(
  jobId: string,
  organizationId: string,
): Promise<JobDetails | null> {
  return prisma.jobDescription.findFirst({
    where: { id: jobId, organizationId },
    select: jobSelect,
  });
}

/** One row in the jobs list. */
export interface JobListItem {
  id: string;
  title: string;
  createdAt: Date;
  matchCount: number;
}

/**
 * Lists an organization's jobs with the number of completed matches, in ONE query
 * (a LEFT JOIN + GROUP BY instead of counting per job).
 */
export async function listJobsWithMatchCounts(organizationId: string): Promise<JobListItem[]> {
  return prisma.$queryRaw<JobListItem[]>`
    SELECT j."id", j."title", j."createdAt", COUNT(m."id")::int AS "matchCount"
    FROM job_descriptions j
    LEFT JOIN match_scores m ON m."jobId" = j."id" AND m."status" = 'completed'
    WHERE j."organizationId" = ${organizationId}::uuid
    GROUP BY j."id"
    ORDER BY j."createdAt" DESC
  `;
}

/**
 * Loads a job by id with no organization check.
 * ONLY for the background worker, which already trusts the batch it claimed.
 * API routes must use findJobInOrganization instead.
 */
export async function findJobById(jobId: string): Promise<JobDetails | null> {
  return prisma.jobDescription.findUnique({ where: { id: jobId }, select: jobSelect });
}

/** Fields a recruiter can set when creating a job (from the form or from an extracted JD). */
export interface NewJobInput {
  organizationId: string;
  createdById: string;
  title: string;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  technologies: string[];
  handsOn: string[];
  languages: string[];
  locations: string[];
  remoteAllowed: boolean;
  experienceYears: number | null;
  seniority: string | null;
  workMode: string | null;
  employmentType: string | null;
  source: "manual" | "pasted" | "uploaded";
  sourceFileName: string | null;
  rawText: string | null;
}

export async function createJob(input: NewJobInput): Promise<JobDetails> {
  return prisma.jobDescription.create({ data: input, select: jobSelect });
}

/** Updates a job's search settings (only within the organization). */
export async function updateJob(
  jobId: string,
  organizationId: string,
  data: Partial<Omit<NewJobInput, "organizationId" | "createdById">>,
): Promise<JobDetails | null> {
  const result = await prisma.jobDescription.updateMany({ where: { id: jobId, organizationId }, data });
  return result.count > 0 ? findJobInOrganization(jobId, organizationId) : null;
}

export async function deleteJob(jobId: string, organizationId: string): Promise<boolean> {
  const result = await prisma.jobDescription.deleteMany({ where: { id: jobId, organizationId } });
  return result.count > 0;
}
