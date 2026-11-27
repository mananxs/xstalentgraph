import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { extensionRoute } from "@/server/extension/route";

export const dynamic = "force-dynamic";

const body = z.object({
  taskId: uuidSchema,
  events: z.array(z.object({ kind: z.enum(["progress", "page", "warning", "error", "info", "session"]), message: z.string().max(400), data: z.record(z.unknown()).default({}) })).max(30).default([]),
  /** The extension's actual sourcing state, so the platform can show what really happens (and detect a self-stop). */
  state: z.enum(["idle", "running", "paused", "stopped", "completed"]).optional(),
  error: z.string().max(500).optional(),
});

/** POST /api/extension/agent/events - progress, warnings and errors of a sourcing run. */
export async function POST(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const input = body.parse(await request.json().catch(() => ({})));
    const task = await prisma.sourcingTask.findFirst({ where: { id: input.taskId, organizationId: recruiter.organizationId, createdById: recruiter.id }, select: { id: true } });
    if (!task) throw new ApiError(404, "Task not found.");
    if (input.events.length) await prisma.taskEvent.createMany({ data: input.events.map((e) => ({ taskId: task.id, kind: e.kind, message: e.message, data: e.data as object })) });
    const data: Record<string, unknown> = {};
    if (input.error) data.lastError = input.error;
    if (input.state === "completed") Object.assign(data, { sourcingState: "completed", completedAt: new Date() });
    else if (input.state === "stopped") data.sourcingState = "stopped";
    else if (input.state === "paused") data.sourcingState = "paused"; // the extension paused itself (session lost, page did not change ...)
    if (Object.keys(data).length) await prisma.sourcingTask.update({ where: { id: task.id }, data });
    const fresh = await prisma.sourcingTask.findUnique({ where: { id: task.id }, select: { sourcingState: true, aiState: true } });
    return NextResponse.json({ ok: true, desired: fresh });
  });
}
