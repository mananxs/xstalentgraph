/** Options for {@link withRetry}. Everything has a sensible default. */
export interface RetryOptions {
  /** How many times to retry after the first failure. Default 5. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Called before each wait, handy for logging. */
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 2000;
const DEFAULT_MAX_DELAY_MS = 60_000;
const NETWORK_ERROR_PATTERN = /fetch failed|network|econnreset|econnrefused|etimedout|socket|timed out|timeout/i;

/** Reads an HTTP status from an error (the Gemini SDK's ApiError has `.status`). */
export function getErrorStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

/** True when a 429 is a DAILY quota: waiting a minute will not help, so callers should move on at once. */
export function isDailyQuotaError(error: unknown): boolean {
  return getErrorStatus(error) === 429 && error instanceof Error && /per ?day|PerDay|daily/i.test(error.message);
}

/** True for rate limits (429, but not daily quotas), server errors (5xx) and network-level failures. */
export function isRetryableError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 429 && isDailyQuotaError(error)) return false;
  if (status !== null) return status === 429 || status >= 500;
  return error instanceof Error && NETWORK_ERROR_PATTERN.test(error.message);
}

/** Gemini 429 messages often say "Please retry in 12.5s". Returns that delay in ms, if present. */
export function parseSuggestedDelayMs(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = /retry in ([\d.]+)\s*s/i.exec(error.message);
  return match?.[1] ? Math.ceil(Number(match[1]) * 1000) : null;
}

/**
 * Runs `operation` and retries when it fails with 429, 5xx or a network error.
 * Waits use exponential backoff with jitter, and respect Gemini's own "retry in Xs" hint.
 * Any other error (bad API key, invalid request...) is thrown immediately.
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableError(error)) throw error;

      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jittered = Math.round(ceiling / 2 + (random() * ceiling) / 2);
      const waitMs = Math.min(maxDelayMs, Math.max(jittered, parseSuggestedDelayMs(error) ?? 0));

      options.onRetry?.({
        attempt: attempt + 1,
        waitMs,
        reason: error instanceof Error ? error.message.slice(0, 160) : "unknown error",
      });
      await sleep(waitMs);
    }
  }
}
