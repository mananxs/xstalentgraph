import { NextResponse } from "next/server";
import { getEnv } from "@/server/env";
import { allowedDomain, googleConfigured } from "@/server/google";

export const dynamic = "force-dynamic";

/** GET /api/auth/options - what the login page may offer (no secrets). */
export async function GET(): Promise<Response> {
  return NextResponse.json({ google: googleConfigured(), password: getEnv().ALLOW_PASSWORD_LOGIN, domain: allowedDomain() });
}
