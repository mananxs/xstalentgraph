import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleRoute } from "@/server/api/http";
import { getEnv } from "@/server/env";
import { createApiKey } from "@/server/extension/auth";
import { verifyPassword } from "@/server/password";
import { ensureOpenRecruiter, findRecruiterForLogin } from "@/server/repositories/recruiterRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = z.object({ email: z.string().trim().min(3).max(200), password: z.string().max(200).default("") });

/** POST /api/extension/login { email, password } -> { apiKey, user }. The key belongs to this recruiter only. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const { email, password } = body.parse(await request.json().catch(() => ({})));
    const env = getEnv();
    let user: { id: string; email: string; name: string };
    if (env.OPEN_ACCESS) {
      // Testing mode: no accounts. Everyone who can reach the site acts as the shared recruiter.
      user = await ensureOpenRecruiter(env.EXTENSION_RECRUITER_EMAIL ?? env.DEV_RECRUITER_EMAIL);
    } else {
      const found = await findRecruiterForLogin(email);
      if (!(await verifyPassword(password, found?.passwordHash)) || !found) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        throw new ApiError(401, "Wrong email or password.");
      }
      user = found;
    }
    const apiKey = await createApiKey(user.id);
    return NextResponse.json({ apiKey, user: { id: user.id, email: user.email, name: user.name } });
  });
}
