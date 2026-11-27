import { jobWhere as jobScope } from "@/server/access";
import { NextResponse } from "next/server";
import { ApiError, handleRoute } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { requireRecruiter } from "@/server/auth";
import { prisma } from "@/server/db";
import { MIME_TYPES } from "@/server/files/parse";
import { recordEvent } from "@/server/hunt/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, "").trim() || "resume";

/**
 * GET /api/candidates/:id/resume[?download=1][&resumeId=]  - the stored original resume.
 * Only people who belong to one of the recruiter's organization's jobs can be read; every view/download is written to the audit log.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const recruiter = await requireRecruiter();
    const id = uuidSchema.parse((await context.params).id);
    const url = new URL(request.url);
    const candidate = await prisma.candidate.findFirst({
      where: { id, matchScores: { some: { job: jobScope(recruiter) } } },
      select: { resumeData: true, resumeFileName: true, resumeFileType: true, resumeText: true },
    });
    if (!candidate) throw new ApiError(404, "Candidate not found.");
    const resumeId = url.searchParams.get("resumeId");
    const stored = await prisma.candidateResume.findFirst({ where: { candidateId: id, organizationId: recruiter.organizationId, ...(resumeId ? { id: uuidSchema.parse(resumeId) } : {}) }, orderBy: { createdAt: "desc" } });
    const download = url.searchParams.get("download") === "1";
    const audit = (what: string) => recordEvent({ organizationId: recruiter.organizationId, candidateId: id, kind: download ? "resume_download" : "resume_view", actorId: recruiter.id, data: { what } }).catch(() => {});

    const file = stored ? { data: stored.data, type: stored.fileType, name: stored.fileName } : candidate.resumeData ? { data: candidate.resumeData, type: candidate.resumeFileType ?? "pdf", name: candidate.resumeFileName ?? "resume" } : null;
    if (file) {
      await audit(file.name);
      return new NextResponse(new Uint8Array(file.data), {
        headers: {
          "Content-Type": MIME_TYPES[file.type] ?? "application/octet-stream",
          "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName(file.name)}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const text = stored?.text ?? candidate.resumeText;
    if (text) {
      await audit("text");
      return new NextResponse(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
    }
    throw new ApiError(404, "No resume is stored for this candidate yet. Request it from the candidate card; it is only retrieved after you approve.");
  });
}
