import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { toBatchDto } from "@/server/api/dto";
import { requireJobAccess, uuidSchema } from "@/server/api/guards";
import { z } from "zod";
import { requireWriter } from "@/server/auth";
import { findBatchOfJob, setBatchControl } from "@/server/repositories/batchRepository";

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

const control = z.object({ action: z.enum(["pause", "resume", "stop"]) });

/** PATCH /api/jobs/:id/batches/:batchId { action: "pause" | "resume" | "stop" } - the play / pause / stop buttons of a search run. */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    await requireWriter();
    const { id, batchId } = await context.params;
    const { job } = await requireJobAccess(id);
    const { action } = control.parse(await request.json().catch(() => ({})));
    const batch = await findBatchOfJob(uuidSchema.parse(batchId), job.id);
    if (!batch) throw new ApiError(404, "Run not found.");
    if (batch.status !== "queued" && batch.status !== "running") throw new ApiError(409, "This run has already finished.");
    if (batch.control === "stop") throw new ApiError(409, "This run was stopped. Start a new one.");
    const ok = await setBatchControl(batch.id, job.id, action === "pause" ? "pause" : action === "resume" ? "run" : "stop");
    if (!ok) throw new ApiError(409, "This run can no longer be changed.");
    const fresh = await findBatchOfJob(batch.id, job.id);
    return jsonOk({ batch: toBatchDto(fresh!) });
  });
}
