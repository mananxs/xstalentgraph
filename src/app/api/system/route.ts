import { getLlmClient } from "@/server/ai/llm";
import { handleRoute, jsonOk } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { getEnv } from "@/server/env";
import { TOP_N } from "@/lib/matches";
import type { SystemStatusDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/system - AI engine and worker status for the Settings page (no secrets). */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    await requireRecruiter();
    const env = getEnv();
    const llm = getLlmClient();
    const status: SystemStatusDto = {
      ai: {
        provider: env.GROQ_API_KEY && (env.LLM_PROVIDER_ORDER === "groq,gemini" || !env.GEMINI_API_KEY) ? "Groq" : env.GEMINI_API_KEY ? "Gemini" : "Offline (Quick score only)",
        configured: llm.configured,
        paused: llm.isPaused(),
        models: [env.LLM_MODEL, ...env.LLM_FALLBACK_MODELS],
        groq: Boolean(env.GROQ_API_KEY),
      },
      worker: { embedded: env.EMBEDDED_WORKER },
      sourcing: {
        maxProfiles: env.SOURCING_MAX_PROFILES,
        displayed: TOP_N,
        linkedin: Boolean(env.APIFY_API_TOKEN),
        cutshort: Boolean(env.CUTSHORT_API_KEY),
      },
    };
    return jsonOk(status);
  });
}
