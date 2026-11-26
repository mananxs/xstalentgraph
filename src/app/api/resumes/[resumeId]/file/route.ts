import { NextResponse } from "next/server";
import { ApiError, handleRoute } from "@/server/api/http";
import { requireResumeAccess } from "@/server/api/resumeGuard";
import { MIME_TYPES } from "@/server/files/parse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ resumeId: string }> };

const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, "").trim() || "resume";

/** GET /api/resumes/:id/file - the resume exactly as it was uploaded. */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { resumeId } = await context.params;
    const { resume } = await requireResumeAccess(resumeId);
    if (!resume.fileData) throw new ApiError(404, "The original file was not stored.");
    return new NextResponse(new Uint8Array(resume.fileData), {
      headers: {
        "Content-Type": MIME_TYPES[resume.fileType] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName(resume.fileName)}"`,
      },
    });
  });
}
