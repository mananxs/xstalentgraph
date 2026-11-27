import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { requireWriter } from "@/server/auth";
import { toJobDetailDto } from "@/server/api/dto";
import { requireJobAccess } from "@/server/api/guards";
import { jobDraftSchema } from "@/server/api/jobInput";
import { deleteJob, updateJob } from "@/server/repositories/jobRepository";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/jobs/:id - full job details (the "current settings" a GitHub search uses). */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const { job } = await requireJobAccess(id);
    return jsonOk({ job: toJobDetailDto(job) });
  });
}

/** PATCH /api/jobs/:id - edit the job after it was created (title, description, skills, locations, ...). The next run uses the new values. */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    await requireWriter();
    const { id } = await context.params;
    const { recruiter, job } = await requireJobAccess(id);
    const body = jobDraftSchema.partial().parse(await request.json().catch(() => ({})));
    const updated = await updateJob(job.id, recruiter.organizationId, body);
    if (!updated) throw new ApiError(404, "Job not found.");
    if (updated.languages.length === 0 && updated.locations.length === 0 && updated.requiredSkills.length === 0 && updated.preferredSkills.length === 0) {
      throw new ApiError(400, "Keep at least one skill, programming language or location, so there is something to search for.");
    }
    return jsonOk({ job: toJobDetailDto(updated) });
  });
}

/** DELETE /api/jobs/:id - removes the job with its matches and resumes. */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    await requireWriter();
    const { id } = await context.params;
    const { recruiter, job } = await requireJobAccess(id);
    await deleteJob(job.id, recruiter.organizationId);
    return jsonOk({ ok: true });
  });
}
