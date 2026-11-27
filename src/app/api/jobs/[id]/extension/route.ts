import { NextResponse } from "next/server";
import { requireJobAccess } from "@/server/api/guards";
import { handleRoute } from "@/server/api/http";
import { connectionView } from "@/server/hunt/tasks";
import { setActiveJob } from "@/server/hunt/activeJob";

export const dynamic = "force-dynamic";

/** POST /api/jobs/:id/extension - "send this job to my extension". The extension adopts it on its next heartbeat. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const { recruiter, job } = await requireJobAccess((await context.params).id);
    await setActiveJob(recruiter.id, job.id);
    return NextResponse.json({ ok: true, connection: await connectionView(recruiter.id) });
  });
}
