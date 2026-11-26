/**
 * Cutshort Public API v1 client (https://cutshort.io/api/v1), plain `fetch`, Bearer auth with a `cs_live_...` key.
 *
 *   GET /search/candidates   triage data only: no name, email or phone. Counts against the `searches` quota.
 *   GET /candidates/{id}     contact details. UNLOCKS the candidate on first call (one `apiUnlocks` credit, irreversible).
 *   GET /usage               { apiUnlocks, searches, messages: { used, limit }, cycleEndsOn }
 *
 * Cutshort asks for sequential calls (no parallel searches) and limits bursts (30 sensitive reads + 120 total per
 * 60 s), so this client never runs two requests at once and the pipeline awaits each call.
 */

const DEFAULT_BASE_URL = "https://cutshort.io/api/v1";

export class CutshortError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Cutshort's `error_code`, e.g. "api_unlock_limit_reached", "insufficient_scope", "invalid_api_key". */
    readonly code?: string,
  ) {
    super(message);
    this.name = "CutshortError";
  }

  /** True when no more credits can be spent this cycle (API quota or the workspace plan). */
  get isUnlockLimit(): boolean {
    return this.code === "api_unlock_limit_reached" || this.code === "plan_unlock_limit_reached";
  }
}

export interface CutshortSearchParams {
  q?: string;
  /** Lucene boolean over the full resume text, e.g. (python OR django) AND (aws OR gcp). */
  inresume?: string;
  minexp?: number;
  maxexp?: number;
  /** Already in Cutshort's format: "Bengaluru+%28Bangalore%29", "Mumbai-Pune". */
  locations?: string;
}

/** One search hit, reduced to what scoring and display need. */
export interface CutshortHit {
  talentCardId: string;
  experienceYears: number | null;
  currentLocation: string | null;
  currentCompany: string | null;
  /** Most recent first. */
  workHistory: string[];
  education: string[];
  /** Short readable lines from profileSignals, e.g. "education pedigree: tier1plus". */
  signals: string[];
  /** Identity-stripped resume excerpt (~4k chars). */
  resumeText: string;
}

export interface CutshortSearchPage {
  hits: CutshortHit[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface CutshortUsage {
  apiUnlocks: { used: number; limit: number };
  searches: { used: number; limit: number };
}

export interface CutshortContact {
  displayName: string | null;
  email: string | null;
  phone: string | null;
  /** true = this call spent an unlock credit. */
  unlockedNow: boolean;
}

export interface CutshortClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const asString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text || null;
};
const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.map(asString).filter((item): item is string => item !== null) : []);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Pulls readable "name: level" lines out of profileSignals without depending on its exact shape. */
function signalLines(value: unknown): string[] {
  if (!isObject(value)) return [];
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const level = isObject(entry) ? asString(entry.level) : asString(entry);
    if (level) lines.push(`${key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}: ${level}`);
  }
  return lines.slice(0, 6);
}

/** Maps one raw search hit. Returns null when it has no id (nothing to score or fetch later). */
export function parseHit(raw: unknown): CutshortHit | null {
  if (!isObject(raw)) return null;
  const id = asString(raw.talentCardId);
  if (!id) return null;
  return {
    talentCardId: id,
    experienceYears: asNumber(raw.experience),
    currentLocation: asString(raw.currentLocation),
    currentCompany: asString(raw.currentCompany),
    workHistory: asStrings(raw.workHistory).slice(0, 8),
    education: asStrings(raw.education).slice(0, 4),
    signals: signalLines(raw.profileSignals),
    resumeText: asString(raw.redactedResumeText) ?? "",
  };
}

export class CutshortClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CutshortClientOptions) {
    if (!options.apiKey) throw new CutshortError("CUTSHORT_API_KEY is not configured.");
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async get(path: string, params?: URLSearchParams): Promise<unknown> {
    const url = `${this.baseUrl}${path}${params && [...params].length > 0 ? `?${params.toString()}` : ""}`;
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.options.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) return response.json().catch(() => ({}));

    const text = (await response.text().catch(() => "")).slice(0, 400);
    let code: string | undefined;
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      code = asString(body.error_code) ?? undefined;
    } catch {
      /* not JSON */
    }
    throw new CutshortError(`Cutshort ${response.status}${code ? ` (${code})` : ""}: ${text || response.statusText}`, response.status, code);
  }

  async usage(): Promise<CutshortUsage> {
    const data = (await this.get("/usage")) as Record<string, unknown>;
    const meter = (value: unknown): { used: number; limit: number } =>
      isObject(value) ? { used: asNumber(value.used) ?? 0, limit: asNumber(value.limit) ?? 0 } : { used: 0, limit: 0 };
    return { apiUnlocks: meter(data.apiUnlocks), searches: meter(data.searches) };
  }

  /** One page of search results (one search against the quota). pageSize is capped at 20 by Cutshort. */
  async search(params: CutshortSearchParams, page = 1, pageSize = 20): Promise<CutshortSearchPage> {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.inresume) query.set("inresume", params.inresume);
    if (params.minexp !== undefined && params.maxexp !== undefined) {
      query.set("minexp", String(params.minexp));
      query.set("maxexp", String(params.maxexp));
    }
    if (params.locations) query.set("locations", params.locations);
    query.set("page", String(page));
    query.set("pageSize", String(Math.min(20, pageSize)));

    const data = (await this.get("/search/candidates", query)) as Record<string, unknown>;
    const results = Array.isArray(data.results) ? data.results : [];
    return {
      hits: results.map(parseHit).filter((hit): hit is CutshortHit => hit !== null),
      page: asNumber(data.page) ?? page,
      pageSize: asNumber(data.pageSize) ?? pageSize,
      totalCount: asNumber(data.totalCount) ?? results.length,
    };
  }

  /** Contact details. A locked candidate is UNLOCKED by this call and costs one credit. */
  async candidate(talentCardId: string): Promise<CutshortContact> {
    const data = (await this.get(`/candidates/${encodeURIComponent(talentCardId)}`)) as Record<string, unknown>;
    return {
      displayName: asString(data.displayName),
      email: asString(data.email),
      phone: asString(data.phone),
      unlockedNow: data.unlockedNow === true,
    };
  }
}
