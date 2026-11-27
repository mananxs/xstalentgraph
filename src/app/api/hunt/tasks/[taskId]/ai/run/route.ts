import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@/server/api/guards";
import { requireWriter } from "@/server/auth";
import { huntRoute } from "@/server/hunt/route";
import { processAnalysisBatch } from "@/server/hunt/tasks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ taskId: string }> };

const body = z.object({ limit: z.number().int().min(1).max(40).default(20) });

/** POST /api/hunt/tasks/:taskId/ai/run - process the next batch of the AI queue (only while AI analysis is running). The page calls it in a loop. */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return huntRoute(async () => {
    const recruiter = await requireWriter();
    const { limit } = body.parse(await request.json().catch(() => ({})));
    return NextResponse.json(await processAnalysisBatch(uuidSchema.parse((await context.params).taskId), recruiter, { limit }));
  });
}
