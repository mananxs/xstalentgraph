import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { fileToText, readUpload } from "@/server/files/parse";
import { extractJd } from "@/server/jd/extract";
import type { JdExtractionDto } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/jobs/extract  (multipart form: `file` = PDF/DOC/DOCX/TXT, or `text` = pasted JD)
 * Reads the JD and returns a DRAFT job for the recruiter to review. Nothing is saved yet.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    await requireRecruiter();
    const form = await request.formData().catch(() => {
      throw new ApiError(400, "Send the JD as a file or as pasted text.");
    });

    const file = form.get("file");
    let rawText: string;
    let fileName: string | null = null;
    if (file instanceof File && file.size > 0) {
      const upload = await readUpload(file);
      fileName = upload.name;
      rawText = await fileToText(upload.name, upload.buffer);
    } else {
      rawText = String(form.get("text") ?? "").trim();
      if (rawText.length < 40) throw new ApiError(400, "Paste the job description (at least a few lines) or upload a file.");
    }

    const extracted = await extractJd(rawText);
    const result: JdExtractionDto = {
      draft: {
        title: extracted.title,
        description: extracted.description,
        requiredSkills: extracted.requiredSkills,
        preferredSkills: extracted.preferredSkills,
        technologies: extracted.technologies,
        handsOn: extracted.handsOn,
        languages: extracted.languages,
        locations: extracted.locations,
        remoteAllowed: extracted.remoteAllowed,
        experienceYears: extracted.experienceYears,
        seniority: extracted.seniority,
        workMode: extracted.workMode,
        employmentType: extracted.employmentType,
      },
      rawText: rawText.slice(0, 60_000),
      source: fileName ? "uploaded" : "pasted",
      fileName,
      extractedBy: extracted.extractedBy,
      notice: extracted.notice ?? null,
    };
    return jsonOk(result);
  });
}
