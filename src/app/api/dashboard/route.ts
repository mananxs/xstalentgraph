import { NextResponse } from "next/server";
import { handleRoute } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { dashboardMetrics } from "@/server/hunt/queries";

export const dynamic = "force-dynamic";

/** GET /api/dashboard - the four headline numbers, counted from the database. */
export async function GET(): Promise<Response> {
  return handleRoute(async () => NextResponse.json(await dashboardMetrics(await requireRecruiter())));
}
