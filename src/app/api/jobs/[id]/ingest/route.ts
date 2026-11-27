import { z } from "zod";
import { requireWriter } from "@/server/auth";
import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { requireJobAccess } from "@/server/api/guards";
import { getEnv } from "@/server/env";
import { normaliseLinkedInUrls } from "@/server/linkedin/profileMapper";
import { createQueuedBatch } from "@/server/repositories/batchRepository";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** Defaults to SOURCING_MAX_PROFILES (the dashboard shows the best 10 of them). */
  maxProfiles: z.number().int().min(1).max(200).optional(),
  /** true = skip the GitHub search and only score candidates that are still unscored or failed. */
  rescoreOnly: z.boolean().default(false),
  /** LinkedIn profile URLs to add and score (URL only: no scraping, they are scored on whatever is known). When set, this run sources from LinkedIn instead of GitHub. */
  linkedinUrls: z.array(z.string().url().max(300)).min(1).max(100).optional(),
  /** The source switches. "github" is exclusive; "linkedin" and "cutshort" may be combined. Omitted = automatic. */
  sources: z.array(z.enum(["github", "linkedin", "cutshort"])).min(1).max(3).optional(),
  /** Older clients: one source. */
  source: z.enum(["github", "linkedin", "cutshort"]).optional(),
});

/**
 * POST /api/jobs/:id/ingest
 * Queues a background run and returns 202 immediately. The worker does the real work.
 * Body (optional): { maxProfiles?: number, rescoreOnly?: boolean, linkedinUrls?: string[] }
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    await requireWriter();
    const { id } = await context.params;
    const { recruiter, job } = await requireJobAccess(id);

    // The body is optional: an empty POST uses the defaults.
    const rawBody: unknown = await request.json().catch(() => ({}));
    const body = bodySchema.parse(rawBody);

    // maxProfiles = 0 is how a "score only, no GitHub search" run is stored (see runBatch).
    const maxProfiles = body.rescoreOnly ? 0 : (body.maxProfiles ?? getEnv().SOURCING_MAX_PROFILES);

    let linkedinUrls: string[] | undefined;
    if (body.linkedinUrls && !body.rescoreOnly) {
      linkedinUrls = normaliseLinkedInUrls(body.linkedinUrls);
      if (linkedinUrls.length === 0) throw new ApiError(400, "No valid LinkedIn profile URLs (expected https://www.linkedin.com/in/<name>).");
    }

    // Which sources this run uses. Pasted URLs are always "linkedin". Otherwise the switches in the UI decide
    // ("github" is exclusive; "linkedin" and "cutshort" can be combined). With no choice: LinkedIn if Apify is set,
    // else Cutshort if its key is set, else GitHub.
    const env = getEnv();
    const configured = { linkedin: Boolean(env.APIFY_API_TOKEN), cutshort: Boolean(env.CUTSHORT_API_KEY) };
    const requested = body.sources ?? (body.source ? [body.source] : []);

    let chosen: Array<"github" | "linkedin" | "cutshort">;
    if (linkedinUrls) chosen = ["linkedin"];
    else if (body.rescoreOnly) chosen = ["github"];
    else if (requested.length === 0) chosen = configured.linkedin ? ["linkedin"] : configured.cutshort ? ["cutshort"] : ["github"];
    else if (requested.includes("github") && requested.length === 1) chosen = ["github"];
    else chosen = requested.filter((source): source is "linkedin" | "cutshort" => source !== "github");

    if (!linkedinUrls && chosen.includes("linkedin") && !configured.linkedin) {
      throw new ApiError(400, "LinkedIn search is not configured. Set APIFY_API_TOKEN in .env and restart.");
    }
    if (chosen.includes("cutshort") && !configured.cutshort) {
      throw new ApiError(400, "Cutshort is not configured. Set CUTSHORT_API_KEY in .env and restart.");
    }
    const source = [...new Set(chosen)].sort().join("+");

    const batchId = await createQueuedBatch({
      jobId: job.id,
      requestedById: recruiter.id,
      maxProfiles: linkedinUrls ? linkedinUrls.length : maxProfiles,
      source,
      linkedinUrls,
    });
    if (!batchId) {
      throw new ApiError(409, "A run is already queued or in progress for this job.");
    }

    return jsonOk({ batchId, status: "queued" }, 202);
  });
}
