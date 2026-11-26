import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/session";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout - clears the session cookie. */
export async function POST(): Promise<Response> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
