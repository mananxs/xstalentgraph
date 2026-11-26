import type { Logger } from "pino";
import { z } from "zod";
import { createLogger } from "@/server/logger";
import { GitHubApiError, GitHubAuthError, GitHubQueryTooHeavyError, GitHubRateLimitError } from "./errors";
import { mapUserNode, type CandidateProfile } from "./profileMapper";
import { SEARCH_USERS_QUERY } from "./queries";
import { envelopeSchema, searchDataSchema, userNodeSchema, type SearchData } from "./schemas";

const GRAPHQL_URL = "https://api.github.com/graphql";
/** GitHub never returns more than 1000 results for one search. */
const GITHUB_SEARCH_RESULT_CAP = 1000;

export interface GitHubClientOptions {
  /** The recruiter's GitHub token (plain text, already decrypted). */
  token: string;
  /** Users per request. Default 20. Smaller pages are gentler on GitHub's query cost. */
  pageSize?: number;
  /** Retries for network errors, 5xx and rate limits. Default 5. */
  maxRetries?: number;
  /** When fewer requests than this remain, wait for the reset before the next call. Default 25. */
  lowRateLimitThreshold?: number;
  /** Longest we will sleep for a rate limit before giving up. Default 65 minutes. */
  maxRateLimitWaitMs?: number;
  requestTimeoutMs?: number;
  // Injectable for tests:
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  logger?: Logger;
}

/** Latest rate limit numbers read from response headers. */
export interface RateLimitState {
  remaining: number;
  resetAtMs: number;
}

type SendOutcome =
  | { kind: "done"; body: unknown }
  | { kind: "retry"; waitMs: number; reason: string; giveUp: Error; maxRetries?: number };

/** Optional hooks for {@link GitHubClient.searchProfiles}. */
export interface SearchOptions {
  /**
   * Called after every page with the profiles that are NEW (not seen in an earlier page or query).
   * Lets the caller save and score candidates while GitHub is still being searched.
   */
  onNewProfiles?: (profiles: CandidateProfile[]) => Promise<void>;
}

const searchInputSchema = z.object({
  queries: z.array(z.string().min(1)).min(1),
  maxProfiles: z.number().int().min(1).max(5000),
});

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
/** GitHub asks for at least a minute after a secondary rate limit without a Retry-After header. */
const SECONDARY_LIMIT_MIN_WAIT_MS = 60_000;
/**
 * 502/504 from GitHub's GraphQL API usually mean "this query took too long", and sending the same
 * query again fails the same way. We retry once (in case it was a blip), then shrink the page instead.
 */
const GATEWAY_TIMEOUT_RETRIES = 1;
const GATEWAY_STATUSES = new Set([502, 504]);
const TIMEOUT_MESSAGE = /timeout|timed out|something went wrong while executing/i;

/**
 * Reads public developer profiles from the GitHub GraphQL API on behalf of one recruiter token.
 * Handles pagination, de-duplication and every kind of rate limit / transient failure.
 */
export class GitHubClient {
  private readonly token: string;
  /** Current users per request. Starts at the configured size and shrinks when GitHub times out. */
  private pageSize: number;
  private readonly maxRetries: number;
  private readonly lowRateLimitThreshold: number;
  private readonly maxRateLimitWaitMs: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly log: Logger;

  private rateLimit: RateLimitState | null = null;

  constructor(options: GitHubClientOptions) {
    if (!options.token) throw new GitHubAuthError();

    this.token = options.token;
    this.pageSize = options.pageSize ?? 20;
    this.maxRetries = options.maxRetries ?? 5;
    this.lowRateLimitThreshold = options.lowRateLimitThreshold ?? 25;
    this.maxRateLimitWaitMs = options.maxRateLimitWaitMs ?? 65 * 60 * 1000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.log = options.logger ?? createLogger("github-client");
  }

  /** The most recent rate limit numbers GitHub told us (null before the first request). */
  getRateLimit(): RateLimitState | null {
    return this.rateLimit;
  }

  /**
   * Runs each search query in order, pages through the results, and collects unique profiles.
   * Stops as soon as `maxProfiles` unique users are collected.
   * @param queries Search strings from `buildSearchQueries`.
   * @param maxProfiles Cap on total unique profiles (1 to 5000).
   * @param options `onNewProfiles` is called after each page, so work can start before the search ends.
   * @throws GitHubAuthError for a bad token, GitHubRateLimitError if the wait is too long,
   *         GitHubApiError if every query failed.
   */
  async searchProfiles(
    queries: string[],
    maxProfiles: number,
    options: SearchOptions = {},
  ): Promise<CandidateProfile[]> {
    const input = searchInputSchema.parse({ queries, maxProfiles });
    const profiles = new Map<string, CandidateProfile>(); // key = githubId, so duplicates collapse
    let lastError: GitHubApiError | null = null;

    for (const searchQuery of input.queries) {
      if (profiles.size >= input.maxProfiles) break;

      try {
        await this.collectQuery(searchQuery, input.maxProfiles, profiles, options);
      } catch (error) {
        // A bad token or a hopeless rate limit affects every query: stop right away.
        if (error instanceof GitHubAuthError || error instanceof GitHubRateLimitError) throw error;
        if (!(error instanceof GitHubApiError)) throw error;

        lastError = error;
        this.log.error({ searchQuery, err: error }, "search query failed, continuing with the next one");
      }
    }

    if (profiles.size === 0 && lastError) throw lastError;

    this.log.info({ queries: input.queries.length, profiles: profiles.size }, "github search finished");
    return [...profiles.values()];
  }

  /** Pages through ONE search query and adds new users into `profiles`. */
  private async collectQuery(
    searchQuery: string,
    maxProfiles: number,
    profiles: Map<string, CandidateProfile>,
    options: SearchOptions,
  ): Promise<void> {
    let after: string | null = null;
    let seenInQuery = 0;

    while (profiles.size < maxProfiles && seenInQuery < GITHUB_SEARCH_RESULT_CAP) {
      const first = Math.min(this.pageSize, GITHUB_SEARCH_RESULT_CAP - seenInQuery);
      let data: SearchData;
      try {
        data = await this.graphql(SEARCH_USERS_QUERY, { searchQuery, first, after }, searchDataSchema);
      } catch (error) {
        // GitHub timed out on a page that was too big: ask for fewer users and retry the same cursor.
        if (error instanceof GitHubQueryTooHeavyError && this.pageSize > 1) {
          const smaller = Math.max(1, Math.floor(this.pageSize / 2));
          this.log.warn({ searchQuery, from: this.pageSize, to: smaller }, "github timed out, retrying with a smaller page");
          this.pageSize = smaller;
          continue;
        }
        throw error;
      }

      const nodes = data.search.nodes ?? [];
      seenInQuery += nodes.length;
      const newOnThisPage: CandidateProfile[] = [];

      for (const rawNode of nodes) {
        if (profiles.size >= maxProfiles) break;

        const parsed = userNodeSchema.safeParse(rawNode);
        if (!parsed.success) {
          this.log.warn({ issues: parsed.error.issues.slice(0, 3) }, "skipping a user node with unexpected shape");
          continue;
        }

        const profile = mapUserNode(parsed.data, new Date(this.now()));
        if (profile && !profiles.has(profile.githubId.toString())) {
          profiles.set(profile.githubId.toString(), profile);
          newOnThisPage.push(profile);
        }
      }

      if (newOnThisPage.length > 0 && options.onNewProfiles) await options.onNewProfiles(newOnThisPage);

      this.log.debug(
        { searchQuery, totalMatches: data.search.userCount, collected: profiles.size, cost: data.rateLimit?.cost },
        "page fetched",
      );

      const { hasNextPage, endCursor } = data.search.pageInfo;
      if (!hasNextPage || !endCursor || nodes.length === 0) break;
      after = endCursor;
    }
  }

  /**
   * Sends one GraphQL request, retrying where it makes sense, and returns validated `data`.
   * Retries: network errors, timeouts, 5xx, 403/429 rate limits, GraphQL RATE_LIMITED errors.
   * Does not retry: 401 (bad token), other 4xx, or responses with errors and no data.
   */
  private async graphql<TData>(
    query: string,
    variables: Record<string, unknown>,
    dataSchema: z.ZodType<TData>,
  ): Promise<TData> {
    for (let attempt = 0; ; attempt += 1) {
      await this.waitIfRateLimited();

      const outcome = await this.sendOnce(query, variables, attempt);
      if (outcome.kind === "retry") {
        if (attempt >= (outcome.maxRetries ?? this.maxRetries)) throw outcome.giveUp;
        await this.pause(outcome.waitMs, outcome.reason, attempt);
        continue;
      }

      const envelope = envelopeSchema.safeParse(outcome.body);
      if (!envelope.success) throw new GitHubApiError("GitHub returned a response we do not understand.");
      const { data, errors } = envelope.data;

      if (errors && errors.length > 0) {
        const limited = errors.some((e) => e.type === "RATE_LIMITED" || /rate limit/i.test(e.message));
        if (limited) {
          const waitMs = this.untilReset();
          this.assertWaitAllowed(waitMs);
          if (attempt >= this.maxRetries) {
            throw new GitHubRateLimitError("GitHub GraphQL rate limit hit and retries are used up.", this.resetAtMs());
          }
          await this.pause(waitMs, "graphql RATE_LIMITED", attempt);
          this.rateLimit = null;
          continue;
        }
        if (data === null || data === undefined) {
          if (errors.some((e) => TIMEOUT_MESSAGE.test(e.message))) {
            throw new GitHubQueryTooHeavyError(`GitHub timed out running the search: ${errors.map((e) => e.message).join("; ")}`);
          }
          throw new GitHubApiError(`GitHub GraphQL error: ${errors.map((e) => e.message).join("; ")}`);
        }
        this.log.warn({ errors: errors.map((e) => e.message) }, "graphql returned partial data with errors");
      }

      const parsed = dataSchema.safeParse(data);
      if (!parsed.success) {
        this.log.error({ issues: parsed.error.issues.slice(0, 3) }, "unexpected GraphQL data shape");
        throw new GitHubApiError("GitHub returned data in an unexpected shape.");
      }
      return parsed.data;
    }
  }

  /** One HTTP round trip. Decides whether the result is final, retryable, or a hard failure. */
  private async sendOnce(
    query: string,
    variables: Record<string, unknown>,
    attempt: number,
  ): Promise<SendOutcome> {
    let response: Response;
    try {
      response = await this.fetchImpl(GRAPHQL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "User-Agent": "talentgraph",
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        kind: "retry",
        waitMs: this.backoffMs(attempt),
        reason: `network error: ${message}`,
        giveUp: new GitHubApiError(`Could not reach GitHub after retries: ${message}`),
      };
    }

    this.recordRateLimit(response.headers);
    const status = response.status;

    if (status === 401) throw new GitHubAuthError();

    if (GATEWAY_STATUSES.has(status)) {
      return {
        kind: "retry",
        waitMs: this.backoffMs(attempt),
        reason: `HTTP ${status} (likely a query timeout)`,
        maxRetries: Math.min(GATEWAY_TIMEOUT_RETRIES, this.maxRetries),
        giveUp: new GitHubQueryTooHeavyError(`GitHub timed out (HTTP ${status}) on this search page.`, status),
      };
    }

    if (status >= 500) {
      return {
        kind: "retry",
        waitMs: this.backoffMs(attempt),
        reason: `HTTP ${status}`,
        giveUp: new GitHubApiError(`GitHub kept returning HTTP ${status}.`, status),
      };
    }

    const text = await response.text();

    if (status === 403 || status === 429) {
      const waitMs = this.rateLimitWaitMs(response.headers, text, status, attempt);
      if (waitMs === null) {
        // A 403 that is not about rate limits (for example an organization's SSO rule).
        throw new GitHubApiError(`GitHub refused the request (403): ${text.slice(0, 200)}`, 403);
      }
      this.assertWaitAllowed(waitMs);
      return {
        kind: "retry",
        waitMs,
        reason: `HTTP ${status} rate limit`,
        giveUp: new GitHubRateLimitError(`GitHub rate limit (HTTP ${status}) and retries are used up.`, this.resetAtMs()),
      };
    }

    if (!response.ok) {
      throw new GitHubApiError(`GitHub returned HTTP ${status}: ${text.slice(0, 200)}`, status);
    }

    try {
      return { kind: "done", body: JSON.parse(text) as unknown };
    } catch {
      throw new GitHubApiError("GitHub returned a body that is not valid JSON.", status);
    }
  }

  /** Before each request: if we are nearly out of quota, sleep until the reset time. */
  private async waitIfRateLimited(): Promise<void> {
    const state = this.rateLimit;
    if (!state || state.remaining > this.lowRateLimitThreshold) return;

    const waitMs = state.resetAtMs - this.now() + 1000;
    if (waitMs <= 0) {
      this.rateLimit = null;
      return;
    }

    this.assertWaitAllowed(waitMs);
    this.log.warn({ remaining: state.remaining, waitMs }, "rate limit almost used up, waiting for reset");
    await this.sleep(waitMs);
    this.rateLimit = null;
  }

  /**
   * How long to wait after a 403/429, or null when the 403 is not a rate limit.
   * Order: Retry-After header, then primary limit (remaining = 0), then secondary limit.
   */
  private rateLimitWaitMs(headers: Headers, bodyText: string, status: number, attempt: number): number | null {
    const retryAfterSeconds = Number.parseInt(headers.get("retry-after") ?? "", 10);
    if (Number.isFinite(retryAfterSeconds)) return retryAfterSeconds * 1000;

    if (headers.get("x-ratelimit-remaining") === "0") return this.untilReset();

    const looksLikeRateLimit = status === 429 || /rate limit|abuse/i.test(bodyText);
    if (!looksLikeRateLimit) return null;

    return Math.max(SECONDARY_LIMIT_MIN_WAIT_MS, this.backoffMs(attempt));
  }

  /** Milliseconds until the known reset time (plus 1s margin). Falls back to 60s if unknown. */
  private untilReset(): number {
    const resetAt = this.resetAtMs();
    return resetAt === null ? SECONDARY_LIMIT_MIN_WAIT_MS : Math.max(1000, resetAt - this.now() + 1000);
  }

  private resetAtMs(): number | null {
    return this.rateLimit?.resetAtMs ?? null;
  }

  private assertWaitAllowed(waitMs: number): void {
    if (waitMs > this.maxRateLimitWaitMs) {
      throw new GitHubRateLimitError(
        `GitHub rate limit resets in ${Math.round(waitMs / 60_000)} minutes, longer than the allowed wait.`,
        this.resetAtMs(),
      );
    }
  }

  /** Reads x-ratelimit-remaining and x-ratelimit-reset (epoch seconds) from a response. */
  private recordRateLimit(headers: Headers): void {
    const remaining = Number.parseInt(headers.get("x-ratelimit-remaining") ?? "", 10);
    const resetSeconds = Number.parseInt(headers.get("x-ratelimit-reset") ?? "", 10);
    if (Number.isFinite(remaining) && Number.isFinite(resetSeconds)) {
      this.rateLimit = { remaining, resetAtMs: resetSeconds * 1000 };
    }
  }

  /** Exponential backoff with jitter: half fixed, half random, doubling each attempt up to 30s. */
  private backoffMs(attempt: number): number {
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
    return Math.round(ceiling / 2 + (this.random() * ceiling) / 2);
  }

  private async pause(waitMs: number, reason: string, attempt: number): Promise<void> {
    this.log.warn({ waitMs, reason, attempt: attempt + 1, maxRetries: this.maxRetries }, "github request will be retried");
    await this.sleep(waitMs);
  }
}
