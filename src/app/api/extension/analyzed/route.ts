import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { extensionRoute } from "@/server/extension/route";
import { rubricHash } from "@/server/extension/rubric";
import { findJobInOrganization } from "@/server/repositories/jobRepository";

export const dynamic = "force-dynamic";

const query = z.object({ jobId: uuidSchema, minScore: z.coerce.number().int().min(0).max(100).default(0), searchSessionId: uuidSchema.optional() });

/** GET /api/extension/analyzed?jobId=&minScore=&searchSessionId= - what this recruiter already scored (current rubric only). */
export async function GET(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const job = await findJobInOrganization(input.jobId, recruiter.organizationId);
    if (!job) throw new ApiError(404, "Job not found.");
    const hash = rubricHash(job);
    const where = { jobId: job.id, recruiterId: recruiter.id, ...(input.searchSessionId ? { sessionIds: { has: input.searchSessionId } } : {}) };
    const [rows, staleCount] = await Promise.all([
      prisma.cardScore.findMany({ where: { ...where, rubricHash: hash, score: { gte: input.minScore } }, orderBy: [{ score: "desc" }, { updatedAt: "desc" }], take: 300 }),
      prisma.cardScore.count({ where: { ...where, NOT: { rubricHash: hash } } }),
    ]);
    return NextResponse.json({
      items: rows.map((row) => ({
        key: row.cardKey,
        kind: row.kind,
        score: row.score,
        displayName: row.displayName,
        profileUrl: row.profileUrl,
        updatedAt: row.updatedAt.toISOString(),
        result: row.result,
      })),
      staleCount,
    });
  });
}
