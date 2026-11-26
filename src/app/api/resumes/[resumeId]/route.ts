import { z } from "zod";
import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { requireResumeAccess } from "@/server/api/resumeGuard";
import { deleteResume, resumeLabel, toResumeDto, updateResume } from "@/server/repositories/resumeRepository";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ resumeId: string }> };

/** GET /api/resumes/:id - one resume with its analysis and (if masked) the anonymized text. */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { resumeId } = await context.params;
    const { resume } = await requireResumeAccess(resumeId);
    const { resumeText: _text, fileData: _file, maskedText, ...row } = resume;
    return jsonOk({ resume: toResumeDto(row), maskedText, label: resumeLabel(row) });
  });
}

const patchSchema = z.object({
  shortlisted: z.boolean().optional(),
  maskedText: z.string().max(60_000).optional(),
});

/** PATCH /api/resumes/:id - shortlist, or save hand-edited anonymized text. */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { resumeId } = await context.params;
    const { recruiter, resume } = await requireResumeAccess(resumeId);
    const body = patchSchema.parse(await request.json().catch(() => ({})));
    const updated = await updateResume(resume.id, recruiter.organizationId, {
      ...(body.shortlisted !== undefined ? { shortlisted: body.shortlisted } : {}),
      ...(body.maskedText !== undefined ? { maskedText: body.maskedText, maskStatus: "masked", maskError: null } : {}),
    });
    if (!updated) throw new ApiError(404, "Resume not found.");
    return jsonOk({ resume: updated });
  });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { resumeId } = await context.params;
    const { recruiter, resume } = await requireResumeAccess(resumeId);
    await deleteResume(resume.id, recruiter.organizationId);
    return jsonOk({ ok: true });
  });
}
