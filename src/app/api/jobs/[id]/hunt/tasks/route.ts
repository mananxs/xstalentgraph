import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { requireJobAccess } from "@/server/api/guards";
import { requireWriter } from "@/server/auth";
import { huntRoute } from "@/server/hunt/route";
import { createTask, taskView } from "@/server/hunt/tasks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/jobs/:id/hunt/tasks - the latest sourcing task of the job (with filters, controls, counters), or null. */
export async function GET(_r: Request, context: Ctx): Promise<Response> {
  return huntRoute(async () => {
    const { recruiter, job } = await requireJobAccess((await context.params).id);
    const latest = await prisma.sourcingTask.findFirst({ where: { jobId: job.id, organizationId: recruiter.organizationId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    return NextResponse.json({ task: latest ? await taskView(latest.id, recruiter) : null });
  });
}

const body = z.object({ filters: z.unknown().optional(), limits: z.unknown().optional() });

/** POST /api/jobs/:id/hunt/tasks - a new sourcing task. Filters default to the job's Resdex search plan. */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return huntRoute(async () => {
    await requireWriter();
    const { recruiter, job } = await requireJobAccess((await context.params).id);
    const input = body.parse(await request.json().catch(() => ({})));
    const task = await createTask(job, recruiter, input);
    return NextResponse.json({ task: await taskView(task.id, recruiter) }, { status: 201 });
  });
}
