import { z } from "zod";
import { ApiError } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { findJobInOrganization, type JobDetails } from "@/server/repositories/jobRepository";
import type { RecruiterContext } from "@/server/repositories/recruiterRepository";

/** Route params like { id } are strings; every id must be a UUID. */
export const uuidSchema = z.string().uuid();

/**
 * The standard check at the top of every job route:
 * 1. the caller is a signed-in recruiter (401 otherwise),
 * 2. the job id is valid (400) and the job belongs to the recruiter's organization (404 otherwise).
 */
export async function requireJobAccess(rawJobId: string): Promise<{ recruiter: RecruiterContext; job: JobDetails }> {
  const recruiter = await requireRecruiter();
  const jobId = uuidSchema.parse(rawJobId);

  const job = await findJobInOrganization(jobId, recruiter.organizationId, recruiter);
  if (!job) throw new ApiError(404, "Job not found.");

  return { recruiter, job };
}
