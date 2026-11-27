import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { extensionRoute } from "@/server/extension/route";
import { taskEvent } from "@/server/hunt/tasks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const fieldStatus = z.object({ status: z.enum(["applied", "unsupported", "failed", "attention"]), detail: z.string().max(300).optional() });
const body = z.object({
  status: z.enum(["done", "failed"]),
  error: z.string().max(500).optional(),
  /** apply_filters */
  fields: z.record(fieldStatus).optional(),
  /** check_session */
  session: z.enum(["unknown", "signed_in", "signed_out", "captcha", "expired", "no_tab"]).optional(),
  /** start/pause/resume/stop_sourcing: what the extension is really doing now */
  state: z.enum(["idle", "running", "paused", "stopped", "completed"]).optional(),
  /** retrieve_profiles */
  items: z.array(z.object({ requestId: z.string().uuid(), status: z.enum(["done", "partial", "failed", "unavailable"]), reason: z.string().max(400).optional(), detail: z.record(z.unknown()).optional() })).max(50).optional(),
});

/**
 * POST /api/extension/agent/commands/:id/result - the extension reports what it REALLY did. Filter statuses come from reading the Naukri
 * form back; a command that was only sent is never shown as applied.
 */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const id = uuidSchema.parse((await context.params).id);
    const result = body.parse(await request.json().catch(() => ({})));
    const command = await prisma.sourcingCommand.findFirst({ where: { id, task: { organizationId: recruiter.organizationId, createdById: recruiter.id } }, include: { task: true } });
    if (!command) throw new ApiError(404, "Command not found.");
    if (command.status === "done" || command.status === "failed") return NextResponse.json({ ok: true, duplicate: true });

    await prisma.sourcingCommand.update({ where: { id }, data: { status: result.status, result: result as unknown as Prisma.InputJsonValue, doneAt: new Date() } });
    const taskId = command.taskId;

    if (command.type === "apply_filters") {
      if (result.status === "done" && result.fields) {
        const applied = Object.values(result.fields).filter((f) => f.status === "applied").length;
        await prisma.sourcingTask.update({ where: { id: taskId }, data: { filterReport: result.fields as unknown as Prisma.InputJsonValue, filtersAppliedAt: applied > 0 ? new Date() : null } });
        await taskEvent(taskId, "filters", `Filters checked on Naukri: ${applied} applied, ${Object.values(result.fields).filter((f) => f.status !== "applied").length} not fully applied`);
      } else await taskEvent(taskId, "error", `Applying filters failed: ${result.error ?? "unknown error"}`);
    } else if (command.type === "check_session") {
      if (result.session) await prisma.extensionConnection.updateMany({ where: { recruiterId: recruiter.id }, data: { naukriState: result.session, naukriCheckedAt: new Date() } });
    } else if (command.type.endsWith("_sourcing")) {
      if (result.status === "failed") {
        await prisma.sourcingTask.update({ where: { id: taskId }, data: { lastError: result.error ?? "The extension could not run this command.", sourcingState: command.type === "start_sourcing" ? "stopped" : undefined } });
        await taskEvent(taskId, "error", result.error ?? `${command.type} failed`);
      } else if (result.state === "completed") {
        await prisma.sourcingTask.update({ where: { id: taskId }, data: { sourcingState: "completed", completedAt: new Date() } });
        await taskEvent(taskId, "completed", "Sourcing finished");
      }
    } else if (command.type === "retrieve_profiles") {
      for (const item of result.items ?? []) {
        await prisma.retrievalRequest.updateMany({
          where: { id: item.requestId, organizationId: recruiter.organizationId },
          data: { status: item.status, reason: item.reason ?? null, result: (item.detail ?? {}) as Prisma.InputJsonValue, attempts: { increment: 1 } },
        });
      }
      await taskEvent(taskId, "retrieval", `Profile retrieval finished for ${(result.items ?? []).length} candidate(s)`);
    }
    return NextResponse.json({ ok: true });
  });
}
