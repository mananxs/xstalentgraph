import { NextResponse } from "next/server";
import { ApiError, handleRoute } from "@/server/api/http";
import { preflight, requireExtension, withCors } from "@/server/api/extAuth";
import { MAX_UPLOAD_BYTES } from "@/server/files/parse";
import { saveNaukriShortlist } from "@/server/naukri/intake";
import { shortlistPayloadSchema } from "@/server/naukri/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const OPTIONS = (request: Request) => preflight(request);

/**
 * POST /api/ext/shortlist - the extension's "Save Card to Shortlist".
 *
 * multipart/form-data:  payload = JSON (see shortlistPayloadSchema), resume = the CV file (optional)
 * application/json:     the same JSON, plus resumeText (the CV text) when no file could be downloaded
 *
 * The platform stores the resume itself, so a recruiter never has to open a Naukri CV link (which needs a live
 * Resdex session and shows a 404 anywhere else).
 */
export async function POST(request: Request): Promise<Response> {
  const response = await handleRoute(async () => {
    const recruiter = await requireExtension(request);
    const contentType = request.headers.get("content-type") ?? "";

    let rawPayload: unknown;
    let resume: { name: string; buffer: Buffer } | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData().catch(() => {
        throw new ApiError(400, "Could not read the upload.");
      });
      const field = form.get("payload");
      if (typeof field !== "string") throw new ApiError(400, "Missing the `payload` JSON field.");
      try {
        rawPayload = JSON.parse(field);
      } catch {
        throw new ApiError(400, "`payload` is not valid JSON.");
      }
      const file = form.get("resume");
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "Resume is larger than 10 MB.");
        resume = { name: file.name || "resume", buffer: Buffer.from(await file.arrayBuffer()) };
      }
    } else {
      rawPayload = await request.json().catch(() => {
        throw new ApiError(400, "Send JSON or multipart/form-data.");
      });
    }

    const payload = shortlistPayloadSchema.parse(rawPayload);
    const result = await saveNaukriShortlist({ recruiter, payload, resume });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  });
  return withCors(request, response);
}
