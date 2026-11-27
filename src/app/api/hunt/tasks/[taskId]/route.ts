import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { requireRecruiter, requireWriter } from "@/server/auth";
import { filtersSchema, limitsSchema } from "@/server/hunt/filters";
import { huntRoute } from "@/server/hunt/route";
import { taskEvent, taskView } from "@/server/hunt/tasks";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ taskId: string }> };

/** GET /api/hunt/tasks/:taskId - live state: controls, counters, filter report, recent events. Poll this. */
export async function GET(_r: Request, context: Ctx): Promise<Response> {
  return huntRoute(async () => {
    const recruiter = await requireRecruiter();
    const view = await taskView(uuidSchema.parse((await context.params).taskId), recruiter);
    if (!view) throw new ApiError(404, "Task not found.");
    return NextResponse.json({ task: view });
  });
}

const patch = z.object({ filters: z.unknown().optional(), limits: z.unknown().optional() });

/** PATCH /api/hunt/tasks/:taskId - save reviewed filters / limits. Changing filters invalidates "applied" until they are applied again. */
export async function PATCH(request: Request, context: Ctx): Promise<Response> {
  return huntRoute(async () => {
    const recruiter = await requireWriter();
    const id = uuidSchema.parse((await context.params).taskId);
    const input = patch.parse(await request.json().catch(() => ({})));
    const task = await prisma.sourcingTask.findFirst({ where: { id, organizationId: recruiter.organizationId, createdById: recruiter.id } });
    if (!task) throw new ApiError(404, "Task not found.");
    if (task.sourcingState === "running") throw new ApiError(409, "Pause or stop sourcing before changing filters.");
    const data: Prisma.SourcingTaskUpdateInput = {};
    if (input.filters !== undefined) Object.assign(data, { filters: filtersSchema.parse(input.filters) as unknown as Prisma.InputJsonValue, filterReport: {}, filtersAppliedAt: null });
    if (input.limits !== undefined) data.limits = limitsSchema.parse(input.limits) as unknown as Prisma.InputJsonValue;
    await prisma.sourcingTask.update({ where: { id }, data });
    await taskEvent(id, "filters", input.filters !== undefined ? "Filters edited (not applied on Naukri yet)" : "Limits edited");
    return NextResponse.json({ task: await taskView(id, recruiter) });
  });
}
