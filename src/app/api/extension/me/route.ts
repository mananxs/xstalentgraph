import { NextResponse } from "next/server";
import { extensionRoute } from "@/server/extension/route";

export const dynamic = "force-dynamic";

/** GET /api/extension/me - validates the key and says WHICH recruiter it belongs to. */
export async function GET(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => NextResponse.json({ user: { id: recruiter.id, email: recruiter.email, name: recruiter.name } }));
}
