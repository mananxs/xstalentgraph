import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { requireWriter } from "@/server/auth";
import { filtersSchema, toSearchFill } from "@/server/hunt/filters";
import { huntRoute } from "@/server/hunt/route";
import { connectionView, jobPayload, queueCommand, taskEvent } from "@/server/hunt/tasks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ taskId: string }> };

const body = z.object({ type: z.enum(["check_session", "apply_filters"]) });

/**
 * POST /api/hunt/tasks/:taskId/commands { type }
 *  check_session  - ask the extension to look at the Resdex tab and report whether the recruiter is signed in.
 *  apply_filters  - send the job + reviewed filters; the extension types them on Naukri, READS THEM BACK, and reports each field.
 * Both need a live extension; otherwise the answer is an honest 409 instead of a queued command nobody will run.
 */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return huntRoute(async () => {
    const recruiter = await requireWriter();
    const id = uuidSchema.parse((await context.params).taskId);
    const { type } = body.parse(await request.json().catch(() => ({})));
    const task = await prisma.sourcingTask.findFirst({ where: { id, organizationId: recruiter.organizationId, createdById: recruiter.id } });
    if (!task) throw new ApiError(404, "Task not found.");
    const conn = await connectionView(recruiter.id);
    if (!conn.connected) throw new ApiError(409, conn.state === "never" ? "No extension has connected yet. Install it and log in with this account." : "The extension is not connected right now (no heartbeat). Open Chrome with the extension and try again.");
    if (type === "apply_filters") {
      if (conn.naukri !== "signed_in") throw new ApiError(409, `Naukri is not ready (${conn.naukri.replace("_", " ")}). Open Resdex in the extension's browser and sign in, then check the session again.`);
      if (task.sourcingState === "running") throw new ApiError(409, "Pause or stop sourcing before applying filters.");
    }
    const payload = type === "apply_filters" ? { ...(await jobPayload(task.jobId, recruiter, recruiter.id)), filters: toSearchFill(filtersSchema.parse(task.filters)) } : {};
    const command = await queueCommand(task.id, type, payload);
    await taskEvent(task.id, "command", type === "apply_filters" ? "Asked the extension to apply the filters on Naukri" : "Asked the extension to check the Naukri session");
    return NextResponse.json({ command: { id: command.id, type, status: command.status } }, { status: 202 });
  });
}
