import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@/server/api/guards";
import { requireWriter } from "@/server/auth";
import { huntRoute } from "@/server/hunt/route";
import { controlAi } from "@/server/hunt/tasks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ taskId: string }> };

const body = z.object({ action: z.enum(["start", "pause", "resume", "stop"]) });

/** POST /api/hunt/tasks/:taskId/ai { action } - Start / Pause / Resume / Stop AI ANALYSIS (independent of sourcing). */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return huntRoute(async () => {
    const recruiter = await requireWriter();
    const { action } = body.parse(await request.json().catch(() => ({})));
    return NextResponse.json(await controlAi(uuidSchema.parse((await context.params).taskId), recruiter.organizationId, action));
  });
}
