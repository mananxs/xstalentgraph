import { NextResponse } from "next/server";
import { requireRecruiter } from "@/server/auth";
import { connectionView } from "@/server/hunt/tasks";
import { huntRoute } from "@/server/hunt/route";

export const dynamic = "force-dynamic";

/** GET /api/hunt/connection - is the extension really connected, and what does it see in Naukri? (from the last heartbeat only) */
export async function GET(): Promise<Response> {
  return huntRoute(async () => NextResponse.json(await connectionView((await requireRecruiter()).id)));
}
