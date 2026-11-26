/**
 * Signed session cookie. Edge-safe (Web Crypto only) because the middleware uses it too.
 * Format: base64url(JSON {rid, exp}) + "." + base64url(HMAC-SHA256).
 */
export const SESSION_COOKIE = "tg_session";
export const SESSION_DAYS = 14;

const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) throw new Error("Set AUTH_SECRET (or TOKEN_ENCRYPTION_KEY) to sign login cookies.");
  return secret;
}

export async function signSession(recruiterId: string, secret = authSecret(), now = Date.now()): Promise<string> {
  const body = b64(enc.encode(JSON.stringify({ rid: recruiterId, exp: now + SESSION_DAYS * 86_400_000 })));
  return `${body}.${b64(await hmac(secret, body))}`;
}

/** Returns the recruiter id, or null for a missing, tampered or expired cookie. */
export async function verifySession(token: string | undefined | null, secret = authSecret(), now = Date.now()): Promise<string | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const expected = await hmac(secret, body);
    const given = unb64(sig);
    if (given.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < given.length; i++) diff |= given[i]! ^ expected[i]!;
    if (diff !== 0) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64(body))) as { rid?: string; exp?: number };
    return payload.rid && typeof payload.exp === "number" && payload.exp > now ? payload.rid : null;
  } catch {
    return null;
  }
}
