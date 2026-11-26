import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  /** Optional: without it every candidate gets the offline "Quick score" instead of an AI score. */
  GEMINI_API_KEY: z.string().optional(),
  /** Optional free backup provider, used when every Gemini model fails. */
  GROQ_API_KEY: z.string().optional(),
  /** "gemini,groq" (default) or "groq,gemini" to make Groq the first choice. */
  LLM_PROVIDER_ORDER: z.enum(["gemini,groq", "groq,gemini"]).default("gemini,groq"),
  LLM_MODEL: z.string().min(1).default("gemini-flash-latest"),
  /** Comma separated backup models, tried in order when the main model is overloaded or retired. */
  LLM_FALLBACK_MODELS: z
    .string()
    .default("gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemma-4-31b-it")
    .transform((value) =>
      value
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  EMBEDDING_MODEL: z.string().min(1).default("gemini-embedding-001"),
  GITHUB_PAT: z.string().optional(),
  /** Apify API token for LinkedIn sourcing (Google Search Scraper). Without it, LinkedIn runs fail with a clear message. */
  APIFY_API_TOKEN: z.string().optional(),
  /** Apify actor that runs the Google searches. */
  APIFY_GOOGLE_SEARCH_ACTOR: z.string().min(1).default("apify~google-search-scraper"),
  /** Micro-queries per actor run. Smaller batches stop sooner once enough candidates are found (saves credits). */
  APIFY_QUERIES_PER_RUN: z.coerce.number().int().min(1).max(50).default(10),
  /** Google result pages fetched per micro-query. */
  APIFY_MAX_PAGES_PER_QUERY: z.coerce.number().int().min(1).max(5).default(1),
  /** Most micro-queries generated for one job (city x title x skill slices). */
  XRAY_MAX_QUERIES: z.coerce.number().int().min(1).max(200).default(60),
  /** Cutshort API key (cs_live_...). With it, LinkedIn runs also search Cutshort's talent database. */
  CUTSHORT_API_KEY: z.string().optional(),
  CUTSHORT_API_BASE_URL: z.string().url().default("https://cutshort.io/api/v1"),
  /** Search pages (20 candidates each) per run. Every page spends one search from the Cutshort quota (eval: 100 per cycle). */
  CUTSHORT_MAX_SEARCHES_PER_RUN: z.coerce.number().int().min(1).max(20).default(3),
  /** Most candidates unlocked (contact details) per run. Each spends one irreversible unlock credit (eval: 10 per cycle). 0 disables. */
  CUTSHORT_MAX_UNLOCKS_PER_RUN: z.coerce.number().int().min(0).max(50).default(3),
  /** Apollo.io API key for phone enrichment. Without it the placeholder (no lookup) is used. */
  APOLLO_API_KEY: z.string().optional(),
  /** After a LinkedIn run, the AI reviews the top N candidates (by free score) for real role fit. 0 disables. Needs GROQ_API_KEY or GEMINI_API_KEY. */
  AI_RESCORE_TOP_N: z.coerce.number().int().min(0).max(100).default(30),
  /** Lowest score (inclusive, 0-100) that may be sent to paid enrichment. Default 75. */
  ENRICHMENT_MIN_SCORE: z.coerce.number().int().min(1).max(100).default(75),
  /** Most paid phone-enrichment lookups per run. Only candidates at or above ENRICHMENT_MIN_SCORE without a phone are ever sent. 0 disables. */
  ENRICHMENT_MAX_PER_BATCH: z.coerce.number().int().min(0).max(500).default(25),
  /** Shared secret the Naukri browser extension sends as "Authorization: Bearer <key>". Without it /api/ext/* is closed. */
  EXTENSION_API_KEY: z.string().min(16).optional(),
  /** Recruiter that extension uploads belong to (defaults to DEV_RECRUITER_EMAIL). */
  EXTENSION_RECRUITER_EMAIL: z.string().email().optional(),
  /** Signs the login cookie. Defaults to TOKEN_ENCRYPTION_KEY, so login works without extra setup. */
  AUTH_SECRET: z.string().min(16).optional(),
  /** TEMPORARY testing switch: no login at all, everyone who can open the site acts as one recruiter. Anyone with the URL sees all data. */
  OPEN_ACCESS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DEV_AUTH: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DEV_RECRUITER_EMAIL: z.string().email().default("recruiter@talentgraph.dev"),
  EVAL_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  /** Run the background worker inside the web server too (default true), so runs never sit in "Queued". */
  EMBEDDED_WORKER: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** How many GitHub profiles one "Find candidates" run fetches (the dashboard shows the top 10). */
  SOURCING_MAX_PROFILES: z.coerce.number().int().min(10).max(200).default(30),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

/**
 * Reads and validates environment variables once.
 * Throws a readable error listing every missing/invalid variable.
 */
export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${problems}`);
  }

  cachedEnv = result.data;
  return cachedEnv;
}
