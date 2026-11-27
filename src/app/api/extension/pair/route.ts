import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleRoute } from "@/server/api/http";
import { redeemPairingCode } from "@/server/extension/pairing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = z.object({ code: z.string().trim().min(6).max(40) });

/** POST /api/extension/pair { code } -> { apiKey, user }. Public on purpose: the one-time code IS the credential. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const { code } = body.parse(await request.json().catch(() => ({})));
    const paired = await redeemPairingCode(code);
    if (!paired) {
      await new Promise((resolve) => setTimeout(resolve, 800)); // slows down guessing
      throw new ApiError(400, "That code is wrong, already used or expired. In XS-Hunt open Settings > Connect extension and create a new one.");
    }
    return NextResponse.json(paired);
  });
}
