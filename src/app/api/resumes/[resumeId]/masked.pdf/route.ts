import { NextResponse } from "next/server";
import { ApiError, handleRoute } from "@/server/api/http";
import { requireResumeAccess } from "@/server/api/resumeGuard";
import { resumeCode } from "@/server/repositories/resumeRepository";
import { buildMaskedPdf } from "@/server/resume/maskPdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ resumeId: string }> };

/** GET /api/resumes/:id/masked.pdf?wm=0|1&download=1 - the anonymized resume as a PDF. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { resumeId } = await context.params;
    const { resume } = await requireResumeAccess(resumeId);
    if (!resume.maskedText) throw new ApiError(404, "This resume has not been anonymized yet.");

    const url = new URL(request.url);
    const watermark = url.searchParams.get("wm") !== "0";
    const code = resumeCode(resume.id);
    const pdf = await buildMaskedPdf(resume.maskedText, {
      code,
      watermark,
      watermarkText: process.env.WATERMARK_TEXT ?? "XS Associates",
    });
    const disposition = url.searchParams.get("download") ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${code}${watermark ? "-watermarked" : ""}.pdf"`,
      },
    });
  });
}
