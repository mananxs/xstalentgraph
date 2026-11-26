import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { requireResumeAccess } from "@/server/api/resumeGuard";
import { resumeCode, updateResume } from "@/server/repositories/resumeRepository";
import { maskResume } from "@/server/resume/mask";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
type RouteContext = { params: Promise<{ resumeId: string }> };

/** POST /api/resumes/:id/mask - creates the anonymized version (AI, or regex redaction as fallback). */
export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { resumeId } = await context.params;
    const { recruiter, resume } = await requireResumeAccess(resumeId);
    let data;
    try {
      const masked = await maskResume(resume.resumeText, resumeCode(resume.id), resume.name);
      data = { maskedText: masked.text, maskStatus: "masked", maskError: null };
    } catch (error) {
      data = { maskStatus: "failed", maskError: error instanceof Error ? error.message.slice(0, 500) : "Masking failed." };
    }
    const updated = await updateResume(resume.id, recruiter.organizationId, data);
    if (!updated) throw new ApiError(404, "Resume not found.");
    return jsonOk({ resume: updated, maskedText: data.maskedText ?? null });
  });
}
