import { NextResponse } from "next/server";
import { handleRoute } from "@/server/api/http";
import { preflight, requireExtension, withCors } from "@/server/api/extAuth";

export const dynamic = "force-dynamic";

export const OPTIONS = (request: Request) => preflight(request);

/** GET /api/ext/ping - lets the extension check the key and show "Connected to TalentGraph". */
export async function GET(request: Request): Promise<Response> {
  const response = await handleRoute(async () => {
    const recruiter = await requireExtension(request);
    return NextResponse.json({ ok: true, recruiter: recruiter.name, apiVersion: 1 });
  });
  return withCors(request, response);
}
