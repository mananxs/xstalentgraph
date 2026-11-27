import { setActiveJob } from "@/server/hunt/activeJob";
import { z } from "zod";
import { requireWriter } from "@/server/auth";
import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { toJobDetailDto } from "@/server/api/dto";
import { jobDraftSchema } from "@/server/api/jobInput";
import { requireRecruiter } from "@/server/auth";
import { createJob, listJobsWithMatchCounts } from "@/server/repositories/jobRepository";
import type { JobSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/jobs - the recruiter's organization jobs with their number of scored candidates. */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const recruiter = await requireRecruiter();
    const rows = await listJobsWithMatchCounts(recruiter.organizationId, recruiter);

    const jobs: JobSummary[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      matchCount: row.matchCount,
      ownerId: row.ownerId,
      ownerName: row.ownerName,
    }));
    return jsonOk({ jobs });
  });
}

const createSchema = jobDraftSchema.extend({
  source: z.enum(["manual", "pasted", "uploaded"]).default("manual"),
  sourceFileName: z.string().max(255).nullable().default(null),
  rawText: z.string().max(60_000).nullable().default(null),
});

/** POST /api/jobs - create a job (usually from a pasted / uploaded JD after the recruiter reviewed it). */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    await requireWriter();
    const recruiter = await requireRecruiter();
    const body = createSchema.parse(await request.json().catch(() => ({})));
    if (body.languages.length === 0 && body.locations.length === 0 && body.requiredSkills.length === 0 && body.preferredSkills.length === 0) {
      throw new ApiError(400, "Add at least one skill, programming language or location, so there is something to search for.");
    }
    const job = await createJob({
      ...body,
      description: body.description || body.title,
      organizationId: recruiter.organizationId,
      createdById: recruiter.id,
    });
    await setActiveJob(recruiter.id, job.id); // a freshly uploaded JD becomes the extension's active job
    return jsonOk({ job: toJobDetailDto(job) }, 201);
  });
}
