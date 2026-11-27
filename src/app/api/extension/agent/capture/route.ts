import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@/server/api/guards";
import { extensionRoute } from "@/server/extension/route";
import { captureCards, HttpError } from "@/server/hunt/tasks";
import { ApiError } from "@/server/api/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({
  taskId: uuidSchema,
  page: z.number().int().min(1).max(500),
  cards: z.array(z.object({ cardKey: z.string().max(80).optional(), position: z.number().int().min(0).max(500), rawText: z.string().min(20).max(6000), profileUrl: z.string().max(1000).nullish() })).min(1).max(60),
});

/** POST /api/extension/agent/capture - the candidate cards of one result page. Safe to send twice. */
export async function POST(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const input = body.parse(await request.json().catch(() => ({})));
    try {
      return NextResponse.json(await captureCards(input.taskId, recruiter, input.page, input.cards));
    } catch (error) {
      if (error instanceof HttpError) throw new ApiError(error.status, error.message);
      throw error;
    }
  });
}
