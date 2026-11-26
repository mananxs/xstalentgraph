import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError } from "@/server/api/http";
import { getEnv } from "@/server/env";
import { ensureOpenRecruiter, findRecruiterByEmail, type RecruiterContext } from "@/server/repositories/recruiterRepository";

/** Origins allowed to call /api/ext/*: the extension itself, Resdex (content scripts) and local dev. */
function originAllowed(origin: string | null): origin is string {
  if (!origin) return false;
  return (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("moz-extension://") ||
    /^https:\/\/([a-z0-9-]+\.)*naukri\.com$/.test(origin) ||
    /^http:\/\/localhost(:\d+)?$/.test(origin)
  );
}

/** Adds CORS headers so the extension (background worker or content script) can call the platform. */
export function withCors(request: Request, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin");
  if (originAllowed(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

/** Answer to the browser's CORS preflight. */
export function preflight(request: Request): NextResponse {
  return withCors(request, new NextResponse(null, { status: 204 }));
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Authenticates an extension call with the shared EXTENSION_API_KEY and returns the recruiter it acts as. */
export async function requireExtension(request: Request): Promise<RecruiterContext> {
  const env = getEnv();
  if (!env.EXTENSION_API_KEY) {
    throw new ApiError(503, "The extension API is switched off. Set EXTENSION_API_KEY (16+ characters) in .env and restart.");
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !safeEqual(token, env.EXTENSION_API_KEY)) {
    throw new ApiError(401, "Wrong or missing extension key. Paste the key from Settings > Naukri extension.");
  }
  const email = env.EXTENSION_RECRUITER_EMAIL ?? env.DEV_RECRUITER_EMAIL;
  const recruiter = env.OPEN_ACCESS ? await ensureOpenRecruiter(email) : await findRecruiterByEmail(email);
  if (!recruiter) throw new ApiError(500, `No recruiter with email ${email}. Run: npx prisma db seed`);
  return recruiter;
}
