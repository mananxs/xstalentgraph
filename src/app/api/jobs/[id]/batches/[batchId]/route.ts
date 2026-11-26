import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { toBatchDto } from "@/server/api/dto";
import { requireJobAccess, uuidSchema } from "@/server/api/guards";
import { findBatchOfJob } from "@/server/repositories/batchRepository";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; batchId: string }> };

/** GET /api/jobs/:id/batches/:batchId - progress of one run. */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id, batchId } = await context.params;
    const { job } = await requireJobAccess(id);

    const batch = await findBatchOfJob(uuidSchema.parse(batchId), job.id);
    if (!batch) throw new ApiError(404, "Run not found.");

    return jsonOk({ batch: toBatchDto(batch) });
  });
}
