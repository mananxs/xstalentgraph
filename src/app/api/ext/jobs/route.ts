import { NextResponse } from "next/server";
import { handleRoute } from "@/server/api/http";
import { preflight, requireExtension, withCors } from "@/server/api/extAuth";
import { listJobsWithMatchCounts } from "@/server/repositories/jobRepository";

export const dynamic = "force-dynamic";

export const OPTIONS = (request: Request) => preflight(request);

/** GET /api/ext/jobs - requirements the extension can file shortlisted candidates under. */
export async function GET(request: Request): Promise<Response> {
  const response = await handleRoute(async () => {
    const recruiter = await requireExtension(request);
    const rows = await listJobsWithMatchCounts(recruiter.organizationId);
    return NextResponse.json({ jobs: rows.map((row) => ({ id: row.id, title: row.title, candidates: row.matchCount })) });
  });
  return withCors(request, response);
}
