import { ThinkingLevel, type GoogleGenAI } from "@google/genai";
import type { Logger } from "pino";
import { createLogger } from "@/server/logger";
import { getGeminiClient } from "./geminiClient";
import { getErrorStatus, isDailyQuotaError, isRetryableError, withRetry, type RetryOptions } from "./retry";

/**
 * One fault-tolerant way to call an LLM, shared by GitHub scoring, JD extraction, resume analysis and masking.
 *
 * Why this exists: free-tier Gemini fails in many small ways (retired model names, 429/503, models that reject
 * thinking settings, JSON schemas, or system instructions). Each of those used to fail the whole candidate.
 * This client works around every one of them automatically:
 *   - tries the models in order, parking a broken / overloaded one for a while;
 *   - per model, steps DOWN through "compatibility modes" when Gemini rejects a setting (400);
 *   - optional Groq backup (GROQ_API_KEY) when every Gemini model is out;
 *   - a circuit breaker: after repeated total failures it pauses LLM calls for a short time, so callers can
 *     switch to their offline fallback immediately instead of waiting on timeouts for every candidate.
 */

/** The only part of the Gemini SDK we need. Tests replace it with a fake. */
export type GenerateApi = Pick<GoogleGenAI["models"], "generateContent">;

/**
 * Compatibility modes, from "everything on" to "plain prompt". A model that rejects a setting moves down a level
 * and remembers it, so later calls go straight to the mode that works.
 *  budget     thinkingBudget (Gemini 2.x style)  + JSON schema + system instruction
 *  level      thinkingLevel LOW (Gemini 3.x)     + JSON schema + system instruction
 *  noThinking no thinking config                 + JSON schema + system instruction
 *  noSchema   JSON mime type only (schema is described in the prompt) + system instruction
 *  plain      nothing special: system text inlined into the prompt (Gemma and other small models)
 */
export type CompatMode = "budget" | "level" | "noThinking" | "noSchema" | "plain";

export interface LlmRequest {
  prompt: string;
  system?: string;
  /** true = the answer must be JSON. */
  json?: boolean;
  /** JSON schema for constrained output (only used when json is true). */
  schema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  /** Optional PDF to read (OCR of scanned files). */
  pdf?: Buffer;
}

export interface LlmResult {
  text: string;
  model: string;
}

export interface LlmClientOptions {
  models: string[];
  api?: GenerateApi | null;
  groqApiKey?: string;
  groqModels?: string[];
  /** Try Groq before Gemini (LLM_PROVIDER_ORDER=groq,gemini). Gemini then becomes the backup. PDFs always use Gemini. */
  groqFirst?: boolean;
  now?: () => number;
  retry?: RetryOptions;
  logger?: Logger;
  /** Total failures in a row before the breaker opens. Default 4. */
  breakerThreshold?: number;
  /** How long the breaker stays open. Default 90 s. */
  breakerCooldownMs?: number;
  fetchImpl?: typeof fetch;
}

/** Thrown while the circuit breaker is open: callers should use their offline fallback. */
export class LlmPausedError extends Error {
  constructor(until: number) {
    super(`AI calls are paused until ${new Date(until).toISOString()} after repeated failures.`);
    this.name = "LlmPausedError";
  }
}

/** After a model fails for good, skip it for this long. */
const OVERLOAD_COOLDOWN_MS = 60_000;
/** A retired / unknown model or a used-up daily quota will not come back soon. */
const LONG_COOLDOWN_MS = 60 * 60_000;
const RETRIES_PER_MODEL = 2;
const MAX_RETRY_WAIT_MS = 20_000;

const MODE_ORDER: CompatMode[] = ["budget", "level", "noThinking", "noSchema", "plain"];

/** Gemini Pro models cannot turn thinking fully off (minimum 128); Flash models can (0). */
function thinkingBudgetFor(model: string): number {
  return /pro/i.test(model) ? 128 : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 404, or a 400 that says the model name is wrong / not usable for generateContent. */
export function isBadModelError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 404) return true;
  return (
    status === 400 &&
    /model.*(not found|is not supported|unsupported|no longer available|decommission)|invalid model|unknown model|unexpected model name|model name format|not found for api version/i.test(
      messageOf(error),
    )
  );
}

/** A 401/403 or an invalid key: no other Gemini model will help (Groq still can). */
function isAuthError(error: unknown): boolean {
  const status = getErrorStatus(error);
  return status === 401 || status === 403 || (status === 400 && /api key|API_KEY_INVALID|permission/i.test(messageOf(error)));
}

/**
 * When a 400 is about one of OUR settings, returns the next compatibility mode to try; otherwise null.
 * (Checked before isBadModelError, because "thinking is not supported" is a settings problem, not a bad model.)
 */
export function nextModeFor(error: unknown, mode: CompatMode): CompatMode | null {
  if (getErrorStatus(error) !== 400) return null;
  const message = messageOf(error);
  const at = MODE_ORDER.indexOf(mode);
  const atLeast = (target: CompatMode): CompatMode | null => {
    const index = Math.max(at + 1, MODE_ORDER.indexOf(target));
    return MODE_ORDER[index] ?? null;
  };

  if (/think/i.test(message)) return mode === "budget" ? "level" : atLeast("noThinking");
  if (/schema|mime|json/i.test(message)) return atLeast("noSchema");
  if (/system|developer instruction|instruction is not enabled/i.test(message)) return "plain";
  return null;
}

/**
 * Turns a raw provider error (often a JSON blob from Google) into one readable sentence for recruiters.
 */
export function describeAiError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(message) as { error?: { message?: string; status?: string } };
    if (parsed.error?.message) message = parsed.error.message;
  } catch {
    /* not JSON */
  }
  if (/API key not valid|API_KEY_INVALID/i.test(message)) return "the Gemini API key is not valid (check GEMINI_API_KEY in .env)";
  if (/PERMISSION_DENIED|permission/i.test(message)) return "the Gemini API key is not allowed to use this model";
  if (/PerDay|per day|daily/i.test(message)) return "the daily Gemini quota is used up (it resets at midnight Pacific time)";
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(message)) return "the Gemini rate limit was reached";
  if (/503|overloaded|high demand|UNAVAILABLE/i.test(message)) return "Gemini is overloaded right now";
  if (/not found|404|no longer available/i.test(message)) return "the configured Gemini models are not available (check LLM_MODEL)";
  if (/paused/i.test(message)) return "AI calls are paused for a moment after repeated failures";
  if (/No AI provider|not set/i.test(message)) return "no AI key is configured";
  return message.length > 160 ? `${message.slice(0, 160)}…` : message;
}

/** Pulls the first {...} block out of a model answer (handles ```json fences and chatty prefixes). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("The AI answer contained no JSON object.");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

/**
 * Cleans a model name from .env: removes quotes, spaces, a trailing "# comment" and a "models/" prefix.
 * Returns "" for anything that still is not a valid model id, so a typo is skipped instead of failing every call.
 */
export function normaliseModelName(raw: string): string {
  const name = raw.replace(/#.*$/, "").trim().replace(/^["'`]+|["'`]+$/g, "").trim().replace(/^models\//i, "");
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : "";
}

const isGptOss = (model: string): boolean => /gpt-oss/i.test(model);

export class LlmClient {
  private readonly models: string[];
  private readonly api: GenerateApi | null;
  private readonly groqApiKey: string | undefined;
  private readonly groqModels: string[];
  private readonly groqFirst: boolean;
  private readonly now: () => number;
  private readonly retry: RetryOptions;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly cooldownUntil = new Map<string, number>();
  private readonly modes = new Map<string, CompatMode>();
  private consecutiveFailures = 0;
  private pausedUntil = 0;

  constructor(options: LlmClientOptions) {
    this.models = [...new Set(options.models.map(normaliseModelName).filter(Boolean))];
    this.api = options.api === undefined ? null : options.api;
    this.groqApiKey = options.groqApiKey || undefined;
    this.groqFirst = Boolean(options.groqFirst);
    this.groqModels = options.groqModels?.length ? options.groqModels : ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];
    this.now = options.now ?? Date.now;
    this.log = options.logger ?? createLogger("llm");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.breakerThreshold = options.breakerThreshold ?? 4;
    this.breakerCooldownMs = options.breakerCooldownMs ?? 90_000;
    this.retry = {
      maxRetries: RETRIES_PER_MODEL,
      maxDelayMs: MAX_RETRY_WAIT_MS,
      onRetry: (info) => this.log.warn(info, "llm call will be retried"),
      ...options.retry,
    };
  }

  /** True when there is at least one provider to call. */
  get configured(): boolean {
    return (this.api !== null && this.models.length > 0) || Boolean(this.groqApiKey);
  }

  /** True while the circuit breaker is open (callers should use their offline fallback). */
  isPaused(): boolean {
    return this.pausedUntil > this.now();
  }

  /** The compatibility mode a model is currently using (exposed for tests and diagnostics). */
  modeOf(model: string): CompatMode {
    return this.modes.get(model) ?? "budget";
  }

  async generate(request: LlmRequest): Promise<LlmResult> {
    if (!this.configured) throw new Error("No AI provider configured (set GEMINI_API_KEY or GROQ_API_KEY).");
    if (this.isPaused()) throw new LlmPausedError(this.pausedUntil);

    try {
      const result = await this.generateAnyProvider(request);
      this.consecutiveFailures = 0;
      return result;
    } catch (error) {
      // Only provider-level outages count towards the breaker (not a single unreadable answer).
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.breakerThreshold) {
        this.pausedUntil = this.now() + this.breakerCooldownMs;
        this.consecutiveFailures = 0;
        this.log.warn({ until: new Date(this.pausedUntil).toISOString() }, "AI keeps failing: pausing AI calls, using fallback");
      }
      throw error;
    }
  }

  /** generate() + JSON parsing. Tries a second time if the first answer is not readable JSON. */
  async generateJson(request: LlmRequest): Promise<{ data: unknown; model: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.generate({ ...request, json: true });
      try {
        return { data: extractJson(result.text), model: result.model };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("The AI did not return valid JSON.");
  }

  private async generateAnyProvider(request: LlmRequest): Promise<LlmResult> {
    const hasGemini = this.api !== null && this.models.length > 0;
    // Groq cannot read PDFs, so those always go to Gemini only.
    const hasGroq = Boolean(this.groqApiKey) && !request.pdf;
    const order: Array<"gemini" | "groq"> = this.groqFirst ? ["groq", "gemini"] : ["gemini", "groq"];

    let firstError: unknown = null;
    for (const provider of order) {
      if (provider === "gemini" ? !hasGemini : !hasGroq) continue;
      try {
        return provider === "gemini" ? await this.generateWithFallback(request) : await this.generateGroq(request);
      } catch (error) {
        firstError ??= error;
        this.log.warn({ err: messageOf(error), provider }, "provider failed, trying the next one");
      }
    }
    throw firstError ?? new Error("No AI provider available for this request.");
  }

  /** Models that are not cooling down, in order. If all are cooling down, try all of them anyway. */
  private modelsToTry(): string[] {
    const available = this.models.filter((model) => (this.cooldownUntil.get(model) ?? 0) <= this.now());
    return available.length > 0 ? available : this.models;
  }

  private async generateWithFallback(request: LlmRequest): Promise<LlmResult> {
    let lastError: unknown;

    for (const model of this.modelsToTry()) {
      try {
        const text = await this.generateWithModel(request, model);
        return { text, model };
      } catch (error) {
        lastError = error;
        const status = getErrorStatus(error);
        if (isAuthError(error)) throw error; // a bad key is the same for every model

        const badModel = isBadModelError(error);
        const canSwitch = badModel || status === 429 || (status !== null && status >= 500) || isRetryableError(error) || status === null;
        if (!canSwitch) throw error;

        const cooldown = badModel || isDailyQuotaError(error) ? LONG_COOLDOWN_MS : OVERLOAD_COOLDOWN_MS;
        this.cooldownUntil.set(model, this.now() + cooldown);
        this.log.warn({ model, status, reason: messageOf(error).slice(0, 160) }, "model unavailable, trying the next one");
      }
    }
    throw lastError ?? new Error("No AI model could be called.");
  }

  /** Calls one model; steps down the compatibility modes when a setting is rejected. */
  private async generateWithModel(request: LlmRequest, model: string): Promise<string> {
    for (let step = 0; step < MODE_ORDER.length; step += 1) {
      const mode = this.modeOf(model);
      try {
        return await this.sendGemini(request, model, mode);
      } catch (error) {
        const next = nextModeFor(error, mode);
        if (!next) throw error;
        this.log.warn({ model, from: mode, to: next }, "model rejected a setting, switching compatibility mode");
        this.modes.set(model, next);
      }
    }
    throw new Error(`Model ${model} rejected every request format.`);
  }

  private async sendGemini(request: LlmRequest, model: string, mode: CompatMode): Promise<string> {
    const api = this.api as GenerateApi;
    const wantsJson = Boolean(request.json);
    const inlineSystem = mode === "plain" && request.system;
    let promptText = inlineSystem ? `${request.system}\n\n${request.prompt}` : request.prompt;
    if (wantsJson && (mode === "noSchema" || mode === "plain") && request.schema) {
      promptText += `\n\nReturn ONLY a JSON object matching this JSON schema:\n${JSON.stringify(request.schema)}`;
    } else if (wantsJson && mode === "plain") {
      promptText += "\n\nReturn ONLY the JSON object, nothing else.";
    }

    const config: Record<string, unknown> = { temperature: request.temperature ?? 0 };
    if (request.maxOutputTokens) config.maxOutputTokens = request.maxOutputTokens;
    if (request.system && mode !== "plain") config.systemInstruction = request.system;
    if (wantsJson && mode !== "plain") config.responseMimeType = "application/json";
    if (wantsJson && request.schema && (mode === "budget" || mode === "level" || mode === "noThinking")) {
      config.responseJsonSchema = request.schema;
    }
    if (mode === "budget") config.thinkingConfig = { thinkingBudget: thinkingBudgetFor(model) };
    if (mode === "level") config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };

    const contents = request.pdf
      ? [{ role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: request.pdf.toString("base64") } }, { text: promptText }] }]
      : promptText;

    const response = await withRetry(() => api.generateContent({ model, contents, config }), this.retry);
    const text = response.text;
    if (!text) throw Object.assign(new Error(`Gemini (${model}) returned an empty answer (it may have been blocked).`), { status: 503 });
    return text;
  }

  /** OpenAI-compatible Groq call (free tier). Used only when every Gemini model failed, or there is no Gemini key. */
  private async generateGroq(request: LlmRequest): Promise<LlmResult> {
    if (!this.groqApiKey) throw new Error("GROQ_API_KEY is not set.");
    if (request.pdf) throw new Error("Groq cannot read PDFs.");
    let lastError: unknown;

    for (const model of this.groqModels) {
      const body = {
        model,
        temperature: request.temperature ?? 0,
        // gpt-oss models "think" first and the thinking counts against max_tokens: keep it short and leave room,
        // otherwise the visible answer can come back empty.
        max_tokens: isGptOss(model) ? Math.max(request.maxOutputTokens ?? 2048, 4096) : (request.maxOutputTokens ?? 2048),
        ...(isGptOss(model) ? { reasoning_effort: "low" } : {}),
        messages: [
          ...(request.system ? [{ role: "system", content: request.system }] : []),
          { role: "user", content: request.prompt + (request.json ? "\n\nReturn ONLY a JSON object." : "") },
        ],
        ...(request.json ? { response_format: { type: "json_object" } } : {}),
      };
      try {
        const data = await withRetry(async () => {
          const response = await this.fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.groqApiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
          });
          if (!response.ok) {
            throw Object.assign(new Error(`Groq ${response.status}: ${(await response.text()).slice(0, 200)}`), { status: response.status });
          }
          return (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        }, this.retry);
        const text = data.choices?.[0]?.message?.content ?? "";
        if (!text) throw new Error("Groq returned an empty answer.");
        return { text, model: `groq:${model}` };
      } catch (error) {
        lastError = error;
        this.log.warn({ model, reason: messageOf(error).slice(0, 160) }, "groq model failed");
      }
    }
    throw lastError ?? new Error("Groq failed.");
  }
}

/** Builds the model list: main model, configured backups, then stable "-latest" aliases as a last resort. */
export function buildModelChain(main: string, fallbacks: string[]): string[] {
  return [...new Set([main, ...fallbacks, "gemini-flash-latest", "gemini-flash-lite-latest"].filter(Boolean))];
}

let sharedClient: LlmClient | undefined;

/**
 * The app-wide client, built from the environment. Never throws: with no API key it is simply "not configured"
 * and every feature falls back to its offline scorer.
 */
export function getLlmClient(): LlmClient {
  if (sharedClient) return sharedClient;
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const main = normaliseModelName(process.env.LLM_MODEL ?? "") || DEFAULT_LLM_MODEL;
  const fallbacks = (process.env.LLM_FALLBACK_MODELS ?? DEFAULT_LLM_FALLBACKS)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const groqModels = (process.env.GROQ_MODELS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  sharedClient = new LlmClient({
    models: buildModelChain(main, fallbacks),
    api: geminiKey ? getGeminiClient().models : null,
    groqApiKey: process.env.GROQ_API_KEY?.trim(),
    groqModels,
    groqFirst: /^\s*groq\s*,/i.test(process.env.LLM_PROVIDER_ORDER ?? ""),
  });
  return sharedClient;
}

/** Defaults that match the CandidateMatch app (known to work on the free tier). */
export const DEFAULT_LLM_MODEL = "gemini-flash-latest";
export const DEFAULT_LLM_FALLBACKS = "gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemma-4-31b-it";
