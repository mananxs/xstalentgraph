import { NextResponse } from "next/server";
import { createLogger } from "@/server/logger";
import { GOOGLE_STATE_COOKIE, GoogleAuthError, googleConfigured, profileFromCode } from "@/server/google";
import { signInWithGoogle } from "@/server/repositories/recruiterRepository";
import { SESSION_COOKIE, SESSION_DAYS, signSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const log = createLogger("google-auth");

const fail = (request: Request, code: string) => {
  const response = NextResponse.redirect(new URL(`/login?error=${code}`, request.url));
  response.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
};

/** GET /api/auth/google/callback - checks the state, verifies the Google account is on the company domain, signs the HR in. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!googleConfigured()) return fail(request, "google_not_configured");
  if (url.searchParams.get("error")) return fail(request, "google_cancelled");

  const cookie = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${GOOGLE_STATE_COOKIE}=`));
  let saved: { state?: string; next?: string } = {};
  try {
    saved = JSON.parse(decodeURIComponent(cookie?.slice(GOOGLE_STATE_COOKIE.length + 1) ?? ""));
  } catch {
    /* missing or garbled */
  }
  const code = url.searchParams.get("code");
  if (!code || !saved.state || saved.state !== url.searchParams.get("state")) return fail(request, "google_state");

  try {
    const profile = await profileFromCode(request, code);
    const recruiter = await signInWithGoogle(profile);
    const next = saved.next && saved.next.startsWith("/") && !saved.next.startsWith("//") ? saved.next : "/dashboard";
    const response = NextResponse.redirect(new URL(next, request.url));
    response.cookies.set(SESSION_COOKIE, await signSession(recruiter.id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86_400 });
    response.cookies.set(GOOGLE_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    if (error instanceof GoogleAuthError) return fail(request, `google_${error.code}`);
    log.error({ err: error }, "google sign-in failed");
    return fail(request, "google_failed");
  }
}
