import { createLogger } from "@/server/logger";
import { linkedinIdFromUrl, linkedinUrlFromId } from "@/server/linkedin/profileMapper";
import type { DiscoveryJobInput, DiscoveryResult, SearchProvider, SerpCandidate } from "./types";
import { buildMicroQueries, DEFAULT_MAX_MICRO_QUERIES } from "./xrayQueries";

/**
 * Discovers LinkedIn candidates with Apify's Google Search Scraper (actor `apify/google-search-scraper`),
 * using plain `fetch`:
 *
 *   POST https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items
 *   { queries: "q1\nq2\n...", resultsPerPage, maxPagesPerQuery, countryCode: "in", languageCode: "en" }
 *   -> [{ searchQuery: { term }, organicResults: [{ title, url, description }, ...] }, ...]   (one item per query page)
 *
 * From each organic result we keep exactly what the pipeline needs: Name, LinkedIn URL and the RAW snippet text.
 * The snippet is later scanned for phone numbers (free) and scored by the offline heuristic, so no per-profile
 * scraping is paid for.
 *
 * Credit conservation: the micro-queries (see xrayQueries.ts) are sent in small batches, and we stop as soon as
 * `maxCandidates` distinct profiles are found. Queries that are never sent cost nothing.
 */

const API_BASE = "https://api.apify.com/v2";
const DEFAULT_ACTOR = "apify~google-search-scraper";
const DEFAULT_QUERIES_PER_RUN = 10;
const DEFAULT_RESULTS_PER_PAGE = 100;
const DEFAULT_MAX_PAGES_PER_QUERY = 1;
/** The sync endpoint answers within 300 s at most; keep a safety margin. */
const RUN_TIMEOUT_SECONDS = 240;
const MAX_SNIPPET_CHARS = 1500;

export class SerpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SerpError";
  }
}

export interface ApifySerpOptions {
  /** Apify API token (APIFY_API_TOKEN). */
  apiToken: string;
  /** Actor id or "username~name". Default "apify~google-search-scraper". */
  actorId?: string;
  /** How many micro-queries go into one actor run. Smaller = stops earlier once enough people are found. Default 10. */
  queriesPerRun?: number;
  /** Results requested per Google page. Default 100 (Google/Apify may return fewer). */
  resultsPerPage?: number;
  /** Google pages per query. Default 1: more slices beat more pages for reach, and cost less. */
  maxPagesPerQuery?: number;
  /** Cap on micro-queries generated per job. Default 60. */
  maxQueries?: number;
  /** Google country. Default "in". */
  countryCode?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Parsing one Google result into a candidate
// ---------------------------------------------------------------------------------------------

const TITLE_SPLIT = /\s+[-–—|]\s+/;
const TITLE_NOISE = /^(linkedin|professional profile|profile|india|view .* profile)$/i;
const PLACE_HINT = /\b(india|bengaluru|bangalore|pune|delhi|gurugram|gurgaon|noida|mumbai|hyderabad|chennai|jaipur|kolkata|ahmedabad|kochi|maharashtra|karnataka|telangana|tamil nadu|haryana|rajasthan|uttar pradesh)\b/i;

/**
 * "Rahul Sharma - Senior Java Developer - Infosys | LinkedIn" -> { name: "Rahul Sharma", headline: "Senior Java Developer - Infosys" }.
 * "Priya N - Pune, Maharashtra, India | Professional Profile | LinkedIn" -> headline null, location "Pune, Maharashtra, India".
 */
export function parseLinkedInTitle(title: string): { name: string | null; headline: string | null; location: string | null } {
  const parts = title
    .replace(/\s+/g, " ")
    .trim()
    .split(TITLE_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part && !TITLE_NOISE.test(part));

  const first = parts[0] ?? "";
  // Names have letters, no digits, and are short. Anything else is a page title, not a person.
  const looksLikeName = first.length >= 2 && first.length <= 60 && !/\d/.test(first) && !/linkedin/i.test(first);
  const name = looksLikeName ? first.replace(/\s*\(.*?\)\s*$/, "").trim() || null : null;

  const rest = looksLikeName ? parts.slice(1) : parts;
  const placeIndex = rest.findIndex((part) => PLACE_HINT.test(part) && part.split(/\s+/).length <= 7);
  const location = placeIndex >= 0 ? (rest[placeIndex] ?? null) : null;
  const headlineParts = rest.filter((_, index) => index !== placeIndex);
  return { name, headline: headlineParts.length > 0 ? headlineParts.join(" - ") : null, location };
}

/** Google's LinkedIn snippets often carry "Location: Pune" / "Location · Pune". */
function locationFromSnippet(snippet: string): string | null {
  const match = /\blocation\s*[:·]\s*([^·|\n]{2,60}?)(?=\s*(?:[·|]|\d+\+?\s+connections|$|\.\s))/i.exec(snippet);
  return match?.[1]?.trim() || null;
}

const asString = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/**
 * Turns the actor's dataset items (or any `{organicResults}` / `{organic}` shaped payload) into candidates.
 * Only real /in/ profiles survive; directory pages, companies and other sites are dropped. Duplicate profiles are
 * merged (their snippets are joined, because a phone number may appear in only one of them).
 */
export function parseSerpItems(payload: unknown): SerpCandidate[] {
  const items = Array.isArray(payload) ? payload : [payload];
  const byId = new Map<string, SerpCandidate>();

  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const query = asString((record.searchQuery as Record<string, unknown> | undefined)?.term);
    const results = Array.isArray(record.organicResults) ? record.organicResults : Array.isArray(record.organic) ? record.organic : [];

    for (const result of results) {
      if (typeof result !== "object" || result === null) continue;
      const row = result as Record<string, unknown>;
      const url = asString(row.url) || asString(row.link);
      if (!/linkedin\.com\/in\//i.test(url)) continue;
      const id = linkedinIdFromUrl(url);
      if (!id) continue;

      const rawTitle = asString(row.title);
      const snippet = (asString(row.description) || asString(row.snippet)).slice(0, MAX_SNIPPET_CHARS);
      const fromTitle = parseLinkedInTitle(rawTitle);

      const existing = byId.get(id);
      if (existing) {
        if (snippet && !existing.snippet.includes(snippet)) existing.snippet = `${existing.snippet} ${snippet}`.trim().slice(0, MAX_SNIPPET_CHARS * 2);
        existing.name ??= fromTitle.name;
        existing.headline ??= fromTitle.headline;
        existing.location ??= fromTitle.location ?? locationFromSnippet(snippet);
        continue;
      }
      byId.set(id, {
        linkedinId: id,
        linkedinUrl: linkedinUrlFromId(id),
        name: fromTitle.name,
        headline: fromTitle.headline,
        location: fromTitle.location ?? locationFromSnippet(snippet),
        rawTitle,
        snippet,
        query,
      });
    }
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------------------------

export class ApifySerpProvider implements SearchProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log = createLogger("serp");

  constructor(private readonly options: ApifySerpOptions) {
    if (!options.apiToken) throw new SerpError("APIFY_API_TOKEN is not configured.");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** One actor run for a batch of queries. Retries once on 429 / 5xx. */
  async search(queries: string[]): Promise<SerpCandidate[]> {
    const actor = encodeURIComponent(this.options.actorId ?? DEFAULT_ACTOR);
    const url = `${API_BASE}/acts/${actor}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_SECONDS}&clean=true`;
    const body = JSON.stringify({
      queries: queries.join("\n"),
      resultsPerPage: this.options.resultsPerPage ?? DEFAULT_RESULTS_PER_PAGE,
      maxPagesPerQuery: this.options.maxPagesPerQuery ?? DEFAULT_MAX_PAGES_PER_QUERY,
      countryCode: this.options.countryCode ?? "in",
      languageCode: "en",
      mobileResults: false,
      saveHtml: false,
    });

    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.options.apiToken}`, "Content-Type": "application/json" },
        body,
      });

      if (response.ok) return parseSerpItems(await response.json().catch(() => []));

      const detail = (await response.text().catch(() => "")).slice(0, 300);
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt === 0) {
        await this.sleep(2000);
        continue;
      }
      throw new SerpError(`Apify Google Search ${response.status}: ${detail || response.statusText}`, response.status);
    }
  }

  async discover(
    job: DiscoveryJobInput,
    maxCandidates: number,
    onNewCandidates?: (candidates: SerpCandidate[]) => Promise<void>,
    /** Called before each paid search run: waits while the recruiter has paused, and may throw to stop the search. */
    beforeRun?: () => Promise<void>,
  ): Promise<DiscoveryResult> {
    const queries = buildMicroQueries(job, { maxQueries: this.options.maxQueries ?? DEFAULT_MAX_MICRO_QUERIES });
    const perRun = Math.max(1, this.options.queriesPerRun ?? DEFAULT_QUERIES_PER_RUN);
    const found = new Map<string, SerpCandidate>(); // insertion order = rank order
    const queriesTried: string[] = [];
    const resultsPerQuery: number[] = [];
    let lastError: unknown;

    for (let start = 0; start < queries.length && found.size < maxCandidates; start += perRun) {
      if (beforeRun) await beforeRun();
      const batch = queries.slice(start, start + perRun);
      queriesTried.push(...batch);
      const added = new Map<string, number>(batch.map((query) => [query, 0]));
      const fresh: SerpCandidate[] = [];

      try {
        for (const candidate of await this.search(batch)) {
          const known = found.get(candidate.linkedinId);
          if (known) {
            // Seen in an earlier run: its new snippet may carry a phone number the first one did not. Re-emit it.
            if (candidate.snippet && !known.snippet.includes(candidate.snippet)) {
              known.snippet = `${known.snippet} ${candidate.snippet}`.trim();
              if (!fresh.includes(known)) fresh.push(known);
            }
            continue;
          }
          if (found.size >= maxCandidates) break;
          found.set(candidate.linkedinId, candidate);
          fresh.push(candidate);
          added.set(candidate.query, (added.get(candidate.query) ?? 0) + 1);
        }
      } catch (error) {
        // One failed run must not stop the remaining slices; the last error is reported only if nothing was found.
        lastError = error;
        this.log.warn({ err: error, queries: batch.length }, "apify serp run failed");
      }

      // Outside the try block on purpose: a failure while saving candidates is a real error, not a search hiccup.
      if (fresh.length > 0 && onNewCandidates) await onNewCandidates(fresh);

      for (const query of batch) resultsPerQuery.push(added.get(query) ?? 0);
      this.log.info({ queries: batch.length, total: found.size }, "apify serp run done");
    }

    if (found.size === 0 && lastError) throw lastError;
    return { candidates: [...found.values()], queriesTried, resultsPerQuery };
  }
}
