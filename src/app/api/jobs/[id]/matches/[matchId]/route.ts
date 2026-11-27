import { z } from "zod";
import { requireWriter } from "@/server/auth";
import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { requireJobAccess, uuidSchema } from "@/server/api/guards";
import { moveStage } from "@/server/hunt/store";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; matchId: string }> };

const bodySchema = z.object({ shortlisted: z.boolean() });

/** PATCH /api/jobs/:id/matches/:matchId  body: { "shortlisted": true | false } */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    await requireWriter();
    const { id, matchId } = await context.params;
    const { recruiter, job } = await requireJobAccess(id);
    const { shortlisted } = bodySchema.parse(await request.json().catch(() => null));

    const match = await prisma.matchScore.findFirst({ where: { id: uuidSchema.parse(matchId), jobId: job.id, job: { organizationId: recruiter.organizationId } }, select: { id: true, stage: true } });
    if (!match) throw new ApiError(404, "Match not found.");
    // Shortlisting is a pipeline stage now; the legacy flag follows it.
    await moveStage({ organizationId: recruiter.organizationId, matchId: match.id, to: shortlisted ? "shortlisted" : ["shortlisted"].includes(match.stage) ? "screening" : match.stage, actorId: recruiter.id });
    return jsonOk({ ok: true, shortlisted });
  });
}
