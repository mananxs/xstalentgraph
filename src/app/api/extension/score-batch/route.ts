import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api/http";
import { prisma } from "@/server/db";
import { cardKey } from "@/server/extension/cardParse";
import { extensionRoute } from "@/server/extension/route";
import { rubricHash } from "@/server/extension/rubric";
import { scoreCard } from "@/server/extension/scoring";
import type { CardResult } from "@/server/extension/types";
import { uuidSchema } from "@/server/api/guards";
import { findJobInOrganization } from "@/server/repositories/jobRepository";
import { normalizeName } from "@/server/extension/names";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({
  jobId: uuidSchema,
  candidates: z.array(z.object({ domId: z.string().max(80), rawText: z.string().min(1).max(6000), profileUrl: z.string().max(1000).optional() })).max(40),
  onlyCached: z.boolean().optional(),
  searchSessionId: uuidSchema.optional(),
});

/**
 * POST /api/extension/score-batch - scores Resdex cards against a job.
 * Every card is scored ON ITS OWN from its own text (offline, deterministic), and a cached score is only reused when the name it
 * was made for is still on the card. A card can therefore never receive another candidate's result.
 * onlyCached=true never scores anything new (Analyzed-only mode / scoring stopped): unknown cards come back in `unscored`.
 */
export async function POST(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const input = body.parse(await request.json().catch(() => ({})));
    const job = await findJobInOrganization(input.jobId, recruiter.organizationId);
    if (!job) throw new ApiError(404, "Job not found.");
    const hash = rubricHash(job);

    const keyed = input.candidates.map((card) => ({ ...card, key: cardKey(card.rawText, card.profileUrl) }));
    const stored = await prisma.cardScore.findMany({
      where: { jobId: job.id, recruiterId: recruiter.id, kind: "card", cardKey: { in: keyed.map((card) => card.key) } },
    });
    const byKey = new Map(stored.map((row) => [row.cardKey, row]));

    const results: CardResult[] = [];
    const unscored: string[] = [];
    for (const card of keyed) {
      const row = byKey.get(card.key);
      const cachedResult = row?.rubricHash === hash ? (row.result as unknown as CardResult) : null;
      const sameName = cachedResult ? normalizeName(cachedResult.extracted?.fullName) === normalizeName(scoreCard(job, card.domId, card.rawText).extracted?.fullName) : false;

      if (row && cachedResult && sameName) {
        results.push({ ...cachedResult, domId: card.domId, key: card.key, cached: true });
        if (input.searchSessionId && !row.sessionIds.includes(input.searchSessionId)) {
          await prisma.cardScore.update({ where: { id: row.id }, data: { sessionIds: [...row.sessionIds, input.searchSessionId] } });
        }
        continue;
      }
      if (input.onlyCached) {
        unscored.push(card.domId);
        continue;
      }
      const result = scoreCard(job, card.domId, card.rawText);
      const data = {
        rubricHash: hash,
        score: result.score,
        displayName: result.extracted?.fullName || null,
        profileUrl: card.profileUrl ?? null,
        result: JSON.parse(JSON.stringify({ ...result, domId: undefined, cached: undefined })),
        sessionIds: input.searchSessionId ? [input.searchSessionId] : [],
      };
      await prisma.cardScore.upsert({
        where: { jobId_recruiterId_cardKey_kind: { jobId: job.id, recruiterId: recruiter.id, cardKey: card.key, kind: "card" } },
        create: { jobId: job.id, recruiterId: recruiter.id, cardKey: card.key, kind: "card", ...data },
        update: data,
      });
      results.push({ ...result, key: card.key });
    }
    return NextResponse.json({ results, missing: [], unscored });
  });
}
