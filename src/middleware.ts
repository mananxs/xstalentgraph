import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/session";

/** Sends visitors without a valid login cookie to /login. API routes answer 401 on their own; /, /login and /api/ext are public. */
export async function middleware(request: NextRequest) {
  if (process.env.OPEN_ACCESS === "true") return NextResponse.next();
  if (process.env.DEV_AUTH === "true" && process.env.NODE_ENV !== "production") return NextResponse.next();
  let signedIn = false;
  try {
    signedIn = (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) !== null;
  } catch {
    /* secret not configured: treat as signed out; /login explains it */
  }
  if (signedIn) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/pipeline/:path*", "/jobs/:path*", "/shortlists/:path*", "/resume-match/:path*", "/integrations/:path*", "/settings/:path*", "/candidates/:path*", "/talent-pool/:path*"] };
