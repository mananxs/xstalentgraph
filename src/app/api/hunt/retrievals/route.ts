import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { requireRecruiter, requireWriter } from "@/server/auth";
import { huntRoute } from "@/server/hunt/route";
import { connectionView, createTask, jobPayload, queueCommand, taskEvent } from "@/server/hunt/tasks";
import { findJobInOrganization } from "@/server/repositories/jobRepository";

export const dynamic = "force-dynamic";

const body = z.object({
  jobId: uuidSchema,
  candidateIds: z.array(uuidSchema).min(1).max(25),
  /** The recruiter confirmed that opening profiles / downloading CVs may spend Naukri credits. Without it nothing happens. */
  creditAck: z.literal(true, { errorMap: () => ({ message: "Confirm the credit warning first: opening a profile or CV can use your Naukri view/download credits." }) }),
});

/**
 * POST /api/hunt/retrievals - approved request to open the full profile and download the CV of SELECTED candidates.
 * Nothing is opened automatically: every candidate here was chosen by the recruiter and the credit warning was confirmed.
 */
export async function POST(request: Request): Promise<Response> {
  return huntRoute(async () => {
    const recruiter = await requireWriter();
    const input = body.parse(await request.json().catch(() => ({})));
    const job = await findJobInOrganization(input.jobId, recruiter.organizationId, recruiter);
    if (!job) throw new ApiError(404, "Job not found.");
    const conn = await connectionView(recruiter.id);
    if (!conn.connected) throw new ApiError(409, "The extension is not connected, so profiles cannot be retrieved.");
    if (conn.naukri !== "signed_in") throw new ApiError(409, `Naukri is not ready (${conn.naukri.replace("_", " ")}). Sign in to Resdex first.`);

    const candidates = await prisma.candidate.findMany({
      where: { id: { in: input.candidateIds }, organizationId: recruiter.organizationId, sources: { has: "naukri" }, matchScores: { some: { jobId: job.id } } },
      select: { id: true, name: true, profileUrl: true, fullProfile: true },
    });
    const task = (await prisma.sourcingTask.findFirst({ where: { jobId: job.id, organizationId: recruiter.organizationId, createdById: recruiter.id, status: "active" }, orderBy: { createdAt: "desc" } })) ?? (await createTask(job, recruiter));

    const requests = [] as Array<{ id: string; candidateId: string; name: string | null; profileUrl: string | null }>;
    const unavailable: Array<{ candidateId: string; reason: string }> = [];
    for (const c of candidates) {
      const usable = /^https?:\/\/[^/]*naukri\.com\/.+/i.test(c.profileUrl);
      if (!usable) {
        unavailable.push({ candidateId: c.id, reason: "No Naukri profile link was captured for this candidate, so the profile cannot be opened automatically." });
        await prisma.retrievalRequest.create({ data: { organizationId: recruiter.organizationId, jobId: job.id, candidateId: c.id, taskId: task.id, approvedById: recruiter.id, creditAck: true, status: "unavailable", reason: "No profile link captured" } });
        continue;
      }
      const row = await prisma.retrievalRequest.create({ data: { organizationId: recruiter.organizationId, jobId: job.id, candidateId: c.id, taskId: task.id, approvedById: recruiter.id, creditAck: true, status: "pending" } });
      requests.push({ id: row.id, candidateId: c.id, name: c.name, profileUrl: c.profileUrl });
    }
    const skipped = input.candidateIds.filter((id) => !candidates.some((c) => c.id === id)).map((candidateId) => ({ candidateId, reason: "Not a Naukri candidate of this job." }));
    if (requests.length) {
      await queueCommand(task.id, "retrieve_profiles", { ...(await jobPayload(job.id, recruiter, recruiter.id)), requests, creditAck: true });
      await taskEvent(task.id, "retrieval", `Recruiter approved retrieving ${requests.length} profile(s)/CV(s)`);
    }
    return NextResponse.json({ queued: requests.length, unavailable: [...unavailable, ...skipped], taskId: task.id }, { status: 202 });
  });
}

/** GET /api/hunt/retrievals?jobId= - status of retrieval requests for a job. */
export async function GET(request: Request): Promise<Response> {
  return huntRoute(async () => {
    const recruiter = await requireRecruiter();
    const jobId = uuidSchema.parse(new URL(request.url).searchParams.get("jobId"));
    if (!(await findJobInOrganization(jobId, recruiter.organizationId, recruiter))) throw new ApiError(404, "Job not found.");
    const rows = await prisma.retrievalRequest.findMany({ where: { jobId, organizationId: recruiter.organizationId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, candidateId: true, status: true, reason: true, createdAt: true, updatedAt: true } });
    return NextResponse.json({ requests: rows });
  });
}
