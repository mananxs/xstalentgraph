import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { extensionRoute } from "@/server/extension/route";
import { captureCards, createTask, HttpError } from "@/server/hunt/tasks";
import { findJobInOrganization } from "@/server/repositories/jobRepository";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({
  jobId: uuidSchema,
  cards: z.array(z.object({ position: z.number().int().min(0).max(500), rawText: z.string().min(20).max(6000), profileUrl: z.string().max(1000).nullish() })).min(1).max(60),
});

const AUTO_LIMITS = { maxPages: 50, maxCandidates: 1000, delaySeconds: 6 };

/**
 * POST /api/extension/agent/auto-capture - the cards the HR is simply LOOKING at in Resdex, sent to the job they have active.
 * No "start" needed: they land in the job's pipeline within seconds and the AI queue ranks them (on the HR's own AI key first).
 * Uses the HR's open task for the job, or opens a new one when there is none or it is full. Safe to send twice.
 */
export async function POST(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const input = body.parse(await request.json().catch(() => ({})));
    const job = await findJobInOrganization(input.jobId, recruiter.organizationId, recruiter);
    if (!job) throw new ApiError(404, "Job not found.");
    let task = await prisma.sourcingTask.findFirst({ where: { jobId: job.id, organizationId: recruiter.organizationId, createdById: recruiter.id, status: "active" }, orderBy: { createdAt: "desc" } });
    if (!task || task.capturedCount >= AUTO_LIMITS.maxCandidates) {
      task = await createTask(job, recruiter, { limits: AUTO_LIMITS });
      task = await prisma.sourcingTask.update({ where: { id: task.id }, data: { aiState: "running" } });
    }
    try {
      const r = await captureCards(task.id, recruiter, Math.max(task.pagesDone, 1), input.cards);
      return NextResponse.json({ taskId: task.id, ...r });
    } catch (error) {
      if (error instanceof HttpError) throw new ApiError(error.status, error.message);
      throw error;
    }
  });
}
