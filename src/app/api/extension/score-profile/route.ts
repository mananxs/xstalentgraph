import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { cardKey } from "@/server/extension/cardParse";
import { extensionRoute } from "@/server/extension/route";
import { rubricHash } from "@/server/extension/rubric";
import { auditProfile } from "@/server/extension/scoring";
import { ensureRubric } from "@/server/hunt/store";
import { findJobInOrganization } from "@/server/repositories/jobRepository";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const body = z.object({ jobId: uuidSchema, rawText: z.string().min(200).max(60_000), profileUrl: z.string().max(1000).optional() });

/** POST /api/extension/score-profile - deep audit of an opened profile (or a card the recruiter chose to audit). */
export async function POST(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const input = body.parse(await request.json().catch(() => ({})));
    const job = await findJobInOrganization(input.jobId, recruiter.organizationId);
    if (!job) throw new ApiError(404, "Job not found.");
    const rubric = await ensureRubric(job, recruiter.id);
    const audit = await auditProfile(job, rubric, input.rawText);

    const key = cardKey(input.rawText, input.profileUrl);
    const data = {
      rubricHash: rubricHash(job, rubric.version),
      score: audit.score,
      displayName: audit.extracted.fullName || null,
      profileUrl: input.profileUrl?.startsWith("http") ? input.profileUrl : null,
      result: JSON.parse(
        JSON.stringify({ score: audit.score, tier: audit.tier, verdict: audit.verdict, matchedSkills: audit.matchedSkills, missingSkills: audit.missingSkills, strengths: audit.strengths, extracted: audit.extracted }),
      ),
    };
    await prisma.cardScore.upsert({
      where: { jobId_recruiterId_cardKey_kind: { jobId: job.id, recruiterId: recruiter.id, cardKey: key, kind: "deep" } },
      create: { jobId: job.id, recruiterId: recruiter.id, cardKey: key, kind: "deep", ...data },
      update: data,
    });
    return NextResponse.json({ audit });
  });
}
