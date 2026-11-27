import { prisma } from "@/server/db";
import { decryptSecret, encryptSecret } from "@/server/crypto/tokens";
import { createLogger } from "@/server/logger";
import type { UserKey } from "./scope";

const log = createLogger("ai-keys");
export const PROVIDERS = ["groq", "gemini"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** How long a rate-limited / out-of-quota key rests before it is tried again. */
export const COOLDOWN_MS = { rate: 5 * 60_000, daily: 60 * 60_000 } as const;

export interface KeyStatus {
  provider: Provider;
  last4: string;
  /** active | cooling | invalid */
  status: string;
  coolingUntil: string | null;
  lastError: string | null;
  lastUsedAt: string | null;
  useCount: number;
}

const cache = new Map<string, { at: number; keys: UserKey[] }>();
const CACHE_MS = 20_000;
export const clearKeyCache = (recruiterId?: string) => (recruiterId ? cache.delete(recruiterId) : cache.clear());

/** Result of asking the provider whether a key works (without spending model tokens). */
export interface KeyCheck {
  ok: boolean;
  /** invalid = the provider rejected the key; unreachable = we could not tell. */
  reason?: "invalid" | "unreachable";
  message?: string;
}

export async function testKey(provider: Provider, key: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  try {
    const res =
      provider === "groq"
        ? await fetchImpl("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12_000) })
        : await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(12_000) });
    if (res.ok) return { ok: true };
    if (res.status === 429) return { ok: true, message: "The key is valid but is rate limited right now." };
    if ([400, 401, 403].includes(res.status)) return { ok: false, reason: "invalid", message: `${provider === "groq" ? "Groq" : "Gemini"} rejected this key.` };
    return { ok: false, reason: "unreachable", message: `${provider === "groq" ? "Groq" : "Gemini"} answered ${res.status}. Try again in a moment.` };
  } catch {
    return { ok: false, reason: "unreachable", message: "Could not reach the provider to check the key. Try again in a moment." };
  }
}

/** Light shape check so an obvious paste mistake is caught before any network call. */
export function looksLikeKey(provider: Provider, key: string): boolean {
  const k = key.trim();
  if (k.length < 20 || k.length > 200 || /\s/.test(k)) return false;
  return provider === "groq" ? k.startsWith("gsk_") : /^[A-Za-z0-9_-]+$/.test(k);
}

export async function saveKey(recruiterId: string, provider: Provider, rawKey: string, check: (p: Provider, k: string) => Promise<KeyCheck> = testKey): Promise<KeyStatus> {
  const key = rawKey.trim();
  if (!looksLikeKey(provider, key)) throw new Error(provider === "groq" ? "That does not look like a Groq key (they start with gsk_)." : "That does not look like a Gemini API key.");
  const verdict = await check(provider, key);
  if (!verdict.ok && verdict.reason === "invalid") throw new Error(verdict.message ?? "The provider rejected this key.");
  // "unreachable" still saves the key: a network blip must not stop someone from adding it. It is re-checked on first use.
  const data = { encryptedKey: encryptSecret(key), last4: key.slice(-4), status: "active", coolingUntil: null, lastError: verdict.ok ? null : (verdict.message ?? null) };
  const row = await prisma.aiCredential.upsert({ where: { recruiterId_provider: { recruiterId, provider } }, create: { recruiterId, provider, ...data }, update: data });
  clearKeyCache(recruiterId);
  return toStatus(row);
}

export async function removeKey(recruiterId: string, provider: Provider): Promise<void> {
  await prisma.aiCredential.deleteMany({ where: { recruiterId, provider } });
  clearKeyCache(recruiterId);
}

const toStatus = (r: { provider: string; last4: string; status: string; coolingUntil: Date | null; lastError: string | null; lastUsedAt: Date | null; useCount: number }): KeyStatus => ({
  provider: r.provider as Provider,
  last4: r.last4,
  status: r.status === "cooling" && r.coolingUntil && r.coolingUntil.getTime() <= Date.now() ? "active" : r.status,
  coolingUntil: r.coolingUntil?.toISOString() ?? null,
  lastError: r.lastError,
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  useCount: r.useCount,
});

export async function listKeys(recruiterId: string): Promise<KeyStatus[]> {
  const rows = await prisma.aiCredential.findMany({ where: { recruiterId } });
  return rows.map(toStatus);
}

/** The recruiter's keys that may be tried right now, in provider preference order (Groq first unless LLM_PROVIDER_ORDER says gemini first). */
export async function loadActiveKeys(recruiterId: string, now = Date.now()): Promise<UserKey[]> {
  const hit = cache.get(recruiterId);
  if (hit && now - hit.at < CACHE_MS) return hit.keys;
  let keys: UserKey[] = [];
  try {
    const rows = await prisma.aiCredential.findMany({ where: { recruiterId, status: { not: "invalid" } } });
    keys = rows
      .filter((r) => r.status === "active" || !r.coolingUntil || r.coolingUntil.getTime() <= now)
      .flatMap((r) => {
        try {
          return [{ id: r.id, provider: r.provider as Provider, key: decryptSecret(r.encryptedKey) }];
        } catch {
          return []; // encrypted with another TOKEN_ENCRYPTION_KEY: unusable until the HR re-enters it
        }
      });
    const geminiFirst = /^\s*gemini\s*,/i.test(process.env.LLM_PROVIDER_ORDER ?? "");
    keys.sort((a, b) => (a.provider === b.provider ? 0 : (a.provider === "gemini") === geminiFirst ? -1 : 1));
  } catch (error) {
    log.warn({ err: error instanceof Error ? error.message : error }, "could not load the recruiter's AI keys (is the migration applied?); using the platform key");
  }
  cache.set(recruiterId, { at: now, keys });
  return keys;
}

export type KeyOutcome = { ok: true } | { ok: false; kind: "invalid" | "rate" | "daily"; message: string };

/** Records what happened to a key, so a bad one stops being tried and a rate-limited one rests. */
export async function recordKeyOutcome(keyId: string, recruiterId: string, outcome: KeyOutcome): Promise<void> {
  try {
    if (outcome.ok) {
      await prisma.aiCredential.update({ where: { id: keyId }, data: { lastUsedAt: new Date(), useCount: { increment: 1 }, status: "active", coolingUntil: null, lastError: null } });
    } else if (outcome.kind === "invalid") {
      await prisma.aiCredential.update({ where: { id: keyId }, data: { status: "invalid", lastError: outcome.message.slice(0, 300) } });
    } else {
      await prisma.aiCredential.update({ where: { id: keyId }, data: { status: "cooling", coolingUntil: new Date(Date.now() + COOLDOWN_MS[outcome.kind]), lastError: outcome.message.slice(0, 300) } });
    }
  } catch {
    /* bookkeeping must never break scoring */
  }
  clearKeyCache(recruiterId);
}
