import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@/server/api/guards";
import { handleRoute } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { analytics } from "@/server/hunt/queries";

export const dynamic = "force-dynamic";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const query = z.object({ from: day, to: day, jobId: uuidSchema.optional(), source: z.enum(["naukri", "linkedin", "github", "cutshort", "direct"]).optional() });

/** GET /api/analytics?from=&to=&jobId=&source= - real pipeline analytics. */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const recruiter = await requireRecruiter();
    const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(await analytics({ organizationId: recruiter.organizationId, jobId: q.jobId, source: q.source, from: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined, to: q.to ? new Date(`${q.to}T23:59:59Z`) : undefined }));
  });
}
