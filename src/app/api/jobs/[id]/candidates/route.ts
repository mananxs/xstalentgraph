import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute } from "@/server/api/http";
import { requireJobAccess } from "@/server/api/guards";
import { listCandidateRows } from "@/server/hunt/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const query = z.object({
  source: z.enum(["naukri", "linkedin", "github", "cutshort", "direct"]).optional(),
  stage: z.string().max(40).optional(),
  tier: z.enum(["strong", "potential", "weak", "provisional", "needs_info"]).optional(),
  q: z.string().max(100).optional(),
  sort: z.enum(["score", "recent", "name"]).default("score"),
  limit: z.coerce.number().int().min(1).max(300).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/jobs/:id/candidates - ONE unified, ranked list across every source (filter by source with ?source=). */
export async function GET(request: Request, context: Ctx): Promise<Response> {
  return handleRoute(async () => {
    const { recruiter, job } = await requireJobAccess((await context.params).id);
    const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(await listCandidateRows({ viewer: recruiter, jobId: job.id, ...q }));
  });
}
