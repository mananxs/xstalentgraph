import { randomBytes } from "node:crypto";
import { isAllowedEmail } from "@/server/access";

/**
 * Google sign-in (OpenID Connect, authorization-code flow), limited to one company domain.
 * The domain is enforced HERE on the verified e-mail Google returns; the `hd` hint only shapes Google's account picker.
 */
export const GOOGLE_STATE_COOKIE = "xs_oauth";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export const allowedDomain = (): string => (process.env.ALLOWED_EMAIL_DOMAIN || "xsassociates.com").trim().toLowerCase().replace(/^@/, "");

/** Public origin of this deployment (APP_URL wins; otherwise the request's own origin, which Vercel sets correctly). */
export function appOrigin(request: Request): string {
  const fixed = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return fixed || new URL(request.url).origin;
}

export const redirectUri = (request: Request): string => `${appOrigin(request)}/api/auth/google/callback`;

export function newState(): string {
  return randomBytes(24).toString("base64url");
}

export function authUrl(request: Request, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    hd: allowedDomain(),
    prompt: "select_account",
    access_type: "online",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export class GoogleAuthError extends Error {
  constructor(
    public readonly code: "domain" | "unverified" | "exchange" | "profile",
    message: string,
  ) {
    super(message);
  }
}

/** Turns the one-time `code` into a verified profile. Throws GoogleAuthError for anything that must not sign in. */
export async function profileFromCode(request: Request, code: string, fetchImpl: typeof fetch = fetch): Promise<GoogleProfile> {
  const tokenRes = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!.trim(), client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(), redirect_uri: redirectUri(request), grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenRes.ok || !token.access_token) throw new GoogleAuthError("exchange", "Google did not accept the sign-in. Try again.");

  const infoRes = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) });
  const info = (await infoRes.json().catch(() => ({}))) as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string; hd?: string };
  return checkProfile(info);
}

/** The rules a Google account must pass. Pure, so it is unit-tested. */
export function checkProfile(info: { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string; hd?: string }): GoogleProfile {
  if (!info.sub || !info.email) throw new GoogleAuthError("profile", "Google did not return your profile.");
  if (info.email_verified !== true) throw new GoogleAuthError("unverified", "Your Google e-mail is not verified.");
  const email = info.email.trim().toLowerCase();
  if (!isAllowedEmail(email) || (info.hd && info.hd.toLowerCase() !== allowedDomain())) {
    throw new GoogleAuthError("domain", `Only @${allowedDomain()} accounts can sign in.`);
  }
  return { sub: info.sub, email, name: (info.name ?? email.split("@")[0] ?? email).slice(0, 100), picture: info.picture ?? null };
}
