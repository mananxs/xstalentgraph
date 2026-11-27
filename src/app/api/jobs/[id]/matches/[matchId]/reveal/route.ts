import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { requireWriter } from "@/server/auth";
import { requireJobAccess, uuidSchema } from "@/server/api/guards";
import { getEnv } from "@/server/env";
import { extractIndianMobile } from "@/server/sourcing/phone";
import { CutshortClient, CutshortError } from "@/server/sourcing/providers/cutshort/client";
import { findCutshortCandidateForMatch, saveCutshortContact } from "@/server/repositories/candidateRepository";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; matchId: string }> };

/**
 * POST /api/jobs/:id/matches/:matchId/reveal
 * Fetches a Cutshort candidate's name, email and phone. The FIRST call for a candidate spends one Cutshort unlock
 * credit (irreversible); later calls are free. Only runs when the recruiter presses "Reveal contact".
 */
export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    await requireWriter();
    const { id, matchId } = await context.params;
    const { job } = await requireJobAccess(id);
    const env = getEnv();
    if (!env.CUTSHORT_API_KEY) throw new ApiError(400, "Cutshort is not configured. Set CUTSHORT_API_KEY in .env and restart.");

    const target = await findCutshortCandidateForMatch(uuidSchema.parse(matchId), job.id);
    if (!target) throw new ApiError(404, "This candidate is not a Cutshort candidate.");

    try {
      const client = new CutshortClient({ apiKey: env.CUTSHORT_API_KEY, baseUrl: env.CUTSHORT_API_BASE_URL });
      const contact = await client.candidate(target.cutshortId);
      const phone = extractIndianMobile(contact.phone) ?? (contact.phone && contact.phone.replace(/\D/g, "").length >= 10 ? contact.phone.replace(/[^\d+]/g, "") : null);
      await saveCutshortContact(target.candidateId, { name: contact.displayName, email: contact.email, phone });
      return jsonOk({ name: contact.displayName, email: contact.email, phone, unlockedNow: contact.unlockedNow });
    } catch (error) {
      if (error instanceof CutshortError) {
        if (error.isUnlockLimit) throw new ApiError(429, "Cutshort unlock credits are used up for this billing cycle.");
        throw new ApiError(502, `Cutshort said: ${error.message.slice(0, 200)}`);
      }
      throw error;
    }
  });
}
