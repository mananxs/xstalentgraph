import { NextResponse } from "next/server";
import { authUrl, GOOGLE_STATE_COOKIE, googleConfigured, newState } from "@/server/google";

export const dynamic = "force-dynamic";

/** GET /api/auth/google?next=/jobs - sends the visitor to Google's account picker. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!googleConfigured()) return NextResponse.redirect(new URL("/login?error=google_not_configured", url));
  const state = newState();
  const next = url.searchParams.get("next") ?? "";
  const response = NextResponse.redirect(authUrl(request, state));
  response.cookies.set(GOOGLE_STATE_COOKIE, JSON.stringify({ state, next: next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard" }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return response;
}
