import { NextResponse } from "next/server";
import { handleRoute } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { createApiKey } from "@/server/extension/auth";

export const dynamic = "force-dynamic";

/** POST /api/extension-keys - a new personal key for the extension (web Settings). The key is shown once; only its hash is stored. */
export async function POST(): Promise<Response> {
  return handleRoute(async () => {
    const recruiter = await requireRecruiter();
    return NextResponse.json({ apiKey: await createApiKey(recruiter.id, "Created in Settings") });
  });
}
