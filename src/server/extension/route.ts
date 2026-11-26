import { NextResponse } from "next/server";
import { handleRoute } from "@/server/api/http";
import { requireExtensionUser } from "./auth";
import type { RecruiterContext } from "@/server/repositories/recruiterRepository";

/** Wraps an /api/extension/* handler: key check, JSON errors, no caching. */
export function extensionRoute(request: Request, handler: (recruiter: RecruiterContext) => Promise<NextResponse>): Promise<NextResponse> {
  return handleRoute(async () => handler(await requireExtensionUser(request)));
}
