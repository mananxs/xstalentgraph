import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { extensionRoute } from "@/server/extension/route";
import { ACK_STALE_MS, jobPayload, processAnalysisBatch } from "@/server/hunt/tasks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({
  deviceId: z.string().min(8).max(80),
  version: z.string().max(30).optional(),
  /** The `at` of the active job this extension already adopted (so the platform only resends it when it changed). */
  activeJobAt: z.string().max(40).optional(),
  naukri: z.object({ state: z.enum(["unknown", "signed_in", "signed_out", "captcha", "expired", "no_tab"]), tabOpen: z.boolean().optional() }).default({ state: "unknown" }),
});

/**
 * POST /api/extension/agent/heartbeat - the extension's pulse. It tells the platform that the browser is alive and what it SEES in the
 * Resdex tab (never cookies), and gets back what to do: new commands, commands it acknowledged but never finished, and the desired
 * run state of its active tasks. Also advances the AI queue of tasks whose AI analysis is running.
 */
export async function POST(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const input = body.parse(await request.json().catch(() => ({})));
    const now = new Date();
    const connection = await prisma.extensionConnection.upsert({
      where: { recruiterId_deviceId: { recruiterId: recruiter.id, deviceId: input.deviceId } },
      create: { organizationId: recruiter.organizationId, recruiterId: recruiter.id, deviceId: input.deviceId, version: input.version ?? null, naukriState: input.naukri.state, naukriCheckedAt: now },
      update: { lastSeenAt: now, version: input.version ?? undefined, naukriState: input.naukri.state, naukriCheckedAt: now },
    });

    const tasks = await prisma.sourcingTask.findMany({ where: { organizationId: recruiter.organizationId, createdById: recruiter.id, status: "active" }, select: { id: true, jobId: true, sourcingState: true, aiState: true, limits: true, pagesDone: true, capturedCount: true } });
    const taskIds = tasks.map((t) => t.id);
    const staleBefore = new Date(now.getTime() - ACK_STALE_MS);
    const commands = taskIds.length
      ? await prisma.sourcingCommand.findMany({
          where: { taskId: { in: taskIds }, OR: [{ status: "pending" }, { status: "acked", ackedAt: { lt: staleBefore } }] },
          orderBy: { createdAt: "asc" },
          take: 10,
          select: { id: true, taskId: true, messageId: true, type: true, payload: true, status: true },
        })
      : [];

    // Advance one running AI queue a little (bounded), so analysis proceeds while the browser is connected even if no page is open.
    const running = tasks.find((t) => t.aiState === "running");
    let ai: { remaining: number; processed: number } | null = null;
    if (running) {
      const r = await processAnalysisBatch(running.id, recruiter, { limit: 8 }).catch(() => null);
      if (r) ai = { remaining: r.remaining, processed: r.processed };
    }
    // The job the HR sent to the extension (uploaded a JD, opened it, pressed "Send to extension"): adopt it automatically.
    const me = await prisma.recruiter.findUnique({ where: { id: recruiter.id }, select: { activeJobId: true, activeJobAt: true } });
    let activeJob: Awaited<ReturnType<typeof jobPayload>> & { at: string } | null = null;
    if (me?.activeJobId && me.activeJobAt && (!input.activeJobAt || new Date(input.activeJobAt).getTime() < me.activeJobAt.getTime())) {
      const payload = await jobPayload(me.activeJobId, recruiter, recruiter.id).catch(() => null);
      if (payload) activeJob = { ...payload, at: me.activeJobAt.toISOString() };
    }
    return NextResponse.json({ connectionId: connection.id, serverTime: now.toISOString(), activeJob, commands, tasks: tasks.map((t) => ({ id: t.id, jobId: t.jobId, sourcingState: t.sourcingState, aiState: t.aiState, limits: t.limits })), ai });
  });
}
