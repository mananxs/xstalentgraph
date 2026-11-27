import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@/server/api/guards";
import { requireWriter } from "@/server/auth";
import { ApiError } from "@/server/api/http";
import { huntRoute } from "@/server/hunt/route";
import { connectionView, controlSourcing } from "@/server/hunt/tasks";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ taskId: string }> };

const body = z.object({ action: z.enum(["start", "pause", "resume", "stop"]), skipFilters: z.boolean().optional() });

/** POST /api/hunt/tasks/:taskId/sourcing { action } - Start / Pause / Resume / Stop SOURCING (independent of AI analysis). */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return huntRoute(async () => {
    const recruiter = await requireWriter();
    const { action, skipFilters } = body.parse(await request.json().catch(() => ({})));
    if (action === "start" || action === "resume") {
      const conn = await connectionView(recruiter.id);
      if (!conn.connected) throw new ApiError(409, "The extension is not connected, so sourcing cannot start.");
      if (conn.naukri !== "signed_in") throw new ApiError(409, `Naukri is not ready (${conn.naukri.replace("_", " ")}). Sign in to Resdex first.`);
    }
    return NextResponse.json(await controlSourcing(uuidSchema.parse((await context.params).taskId), recruiter, action, { skipFilters }));
  });
}
