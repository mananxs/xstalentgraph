import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleRoute } from "@/server/api/http";
import { getEnv } from "@/server/env";
import { verifyPassword } from "@/server/password";
import { findRecruiterForLogin } from "@/server/repositories/recruiterRepository";
import { SESSION_COOKIE, SESSION_DAYS, signSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });

/** POST /api/auth/login { email, password } -> sets the signed session cookie. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    if (!getEnv().ALLOW_PASSWORD_LOGIN) throw new ApiError(403, "Password sign-in is turned off. Use Continue with Google.");
    const { email, password } = bodySchema.parse(await request.json().catch(() => ({})));
    const recruiter = await findRecruiterForLogin(email);
    const valid = await verifyPassword(password, recruiter?.passwordHash);
    if (!recruiter || !valid) {
      await new Promise((resolve) => setTimeout(resolve, 600)); // slows down password guessing
      throw new ApiError(401, "Wrong email or password.");
    }
    const response = NextResponse.json({ ok: true, name: recruiter.name });
    response.cookies.set(SESSION_COOKIE, await signSession(recruiter.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_DAYS * 86_400,
    });
    return response;
  });
}
