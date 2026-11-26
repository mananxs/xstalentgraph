import { z } from "zod";
import { handleRoute, jsonOk } from "@/server/api/http";
import { toMatchDto } from "@/server/api/dto";
import { requireJobAccess } from "@/server/api/guards";
import { listMatches } from "@/server/repositories/matchRepository";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const querySchema = z.object({
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/jobs/:id/matches?minScore=&limit=&offset= - scored candidates best first, then unscored ones. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const { job } = await requireJobAccess(id);

    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { minScore, limit, offset } = querySchema.parse(params);

    const rows = await listMatches({ jobId: job.id, minScore, limit, offset });
    return jsonOk({ matches: rows.map(toMatchDto) });
  });
}
