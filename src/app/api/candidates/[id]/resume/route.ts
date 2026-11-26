import { NextResponse } from "next/server";
import { ApiError, handleRoute } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { requireRecruiter } from "@/server/auth";
import { prisma } from "@/server/db";
import { MIME_TYPES } from "@/server/files/parse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, "").trim() || "resume";

/**
 * GET /api/candidates/:id/resume[?download=1] - the resume stored in the platform.
 * Only candidates filed under one of the recruiter's organization jobs can be read.
 * When nothing is stored it answers 404 with a JSON message that the profile page turns into a clear instruction.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const recruiter = await requireRecruiter();
    const id = uuidSchema.parse((await context.params).id);
    const candidate = await prisma.candidate.findFirst({
      where: { id, matchScores: { some: { job: { organizationId: recruiter.organizationId } } } },
      select: { resumeData: true, resumeFileName: true, resumeFileType: true, resumeText: true, name: true },
    });
    if (!candidate) throw new ApiError(404, "Candidate not found.");

    if (candidate.resumeData) {
      const type = candidate.resumeFileType ?? "pdf";
      const download = new URL(request.url).searchParams.get("download") === "1";
      return new NextResponse(new Uint8Array(candidate.resumeData), {
        headers: {
          "Content-Type": MIME_TYPES[type] ?? "application/octet-stream",
          "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName(candidate.resumeFileName ?? `resume.${type}`)}"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    }
    if (candidate.resumeText) {
      return new NextResponse(candidate.resumeText, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    throw new ApiError(404, "No resume is stored for this candidate yet. Re-save the card from the Naukri extension to upload it.");
  });
}
