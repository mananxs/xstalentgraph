import { z } from "zod";
import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { requireJobAccess, uuidSchema } from "@/server/api/guards";
import { setShortlisted } from "@/server/repositories/matchRepository";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; matchId: string }> };

const bodySchema = z.object({ shortlisted: z.boolean() });

/** PATCH /api/jobs/:id/matches/:matchId  body: { "shortlisted": true | false } */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id, matchId } = await context.params;
    const { recruiter, job } = await requireJobAccess(id);
    const { shortlisted } = bodySchema.parse(await request.json().catch(() => null));

    const updated = await setShortlisted({
      matchId: uuidSchema.parse(matchId),
      jobId: job.id,
      organizationId: recruiter.organizationId,
      shortlisted,
    });
    if (!updated) throw new ApiError(404, "Match not found.");

    return jsonOk({ ok: true, shortlisted });
  });
}
