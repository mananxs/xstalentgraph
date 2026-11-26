import { handleRoute, jsonOk } from "@/server/api/http";
import { toBatchDto } from "@/server/api/dto";
import { requireJobAccess } from "@/server/api/guards";
import { findLatestBatchOfJob } from "@/server/repositories/batchRepository";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/jobs/:id/batches - the latest run of this job (or null), so the page can resume progress. */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const { job } = await requireJobAccess(id);

    const batch = await findLatestBatchOfJob(job.id);
    return jsonOk({ batch: batch ? toBatchDto(batch) : null });
  });
}
