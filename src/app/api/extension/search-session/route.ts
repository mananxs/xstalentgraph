import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { extensionRoute } from "@/server/extension/route";
import { rubricHash } from "@/server/extension/rubric";
import { ensureRubric } from "@/server/hunt/store";
import { findJobInOrganization } from "@/server/repositories/jobRepository";

export const dynamic = "force-dynamic";

const body = z.object({ jobId: uuidSchema, signature: z.string().min(1).max(200), state: z.record(z.unknown()).default({}) });

function labelOf(state: Record<string, unknown>): string {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const parts = [text(state.keywords).slice(0, 60), text(state.location)];
  const min = state.minExp;
  const max = state.maxExp;
  if (typeof min === "number" || typeof max === "number") parts.push(`${min ?? "?"}-${max ?? "?"} yrs`);
  return parts.filter(Boolean).join(" · ") || "Naukri search";
}

/** POST /api/extension/search-session - the Naukri search that produced the cards on screen (one per distinct search). */
export async function POST(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const input = body.parse(await request.json().catch(() => ({})));
    const job = await findJobInOrganization(input.jobId, recruiter.organizationId, recruiter);
    if (!job) throw new ApiError(404, "Job not found.");
    const session = await prisma.searchSession.upsert({
      where: { jobId_recruiterId_signature: { jobId: job.id, recruiterId: recruiter.id, signature: input.signature } },
      create: { jobId: job.id, recruiterId: recruiter.id, signature: input.signature, label: labelOf(input.state), state: JSON.parse(JSON.stringify(input.state)) },
      update: {},
    });
    const analyzedCount = await prisma.cardScore.count({ where: { jobId: job.id, recruiterId: recruiter.id, rubricHash: rubricHash(job, (await ensureRubric(job, recruiter.id)).version), sessionIds: { has: session.id } } });
    return NextResponse.json({ session: { id: session.id, label: session.label, analyzedCount } });
  });
}
