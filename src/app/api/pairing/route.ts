import { NextResponse } from "next/server";
import { handleRoute } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { appOrigin } from "@/server/google";
import { connectionString, createPairingCode } from "@/server/extension/pairing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/pairing - a one-time code (valid 10 minutes) that connects the extension to THIS signed-in HR, with no password typed in the extension. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const me = await requireRecruiter();
    const { code, expiresAt } = await createPairingCode(me.id);
    return NextResponse.json({ code, expiresAt: expiresAt.toISOString(), connection: connectionString(appOrigin(request), code), origin: appOrigin(request) });
  });
}
