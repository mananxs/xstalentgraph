import { ApiError, handleRoute, jsonOk } from "@/server/api/http";
import { requireWriter } from "@/server/auth";
import { requireJobAccess } from "@/server/api/guards";
import { fileToText, readUpload } from "@/server/files/parse";
import { createLogger } from "@/server/logger";
import { createResume, listResumes } from "@/server/repositories/resumeRepository";
import { analyzeResume, scoreResume } from "@/server/resume/analyze";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const log = createLogger("resumes");
type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/jobs/:id/resumes - resumes analysed for this job, best first. */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const { recruiter, job } = await requireJobAccess(id);
    return jsonOk({ resumes: await listResumes(job.id, recruiter.organizationId) });
  });
}

/**
 * POST /api/jobs/:id/resumes  (multipart: `file`)
 * ONE resume per request (the browser loops), so no request runs for minutes.
 * Never fails because of the AI: the offline Quick score is used when the AI is unavailable.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleRoute(async () => {
    await requireWriter();
    const { id } = await context.params;
    const { recruiter, job } = await requireJobAccess(id);

    const form = await request.formData().catch(() => {
      throw new ApiError(400, "Upload a resume file.");
    });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "Upload a resume file (PDF, DOC, DOCX or TXT).");

    const upload = await readUpload(file);
    const text = await fileToText(upload.name, upload.buffer);
    const analysis = await analyzeResume(job, text);
    const requiredYears = job.experienceYears && job.experienceYears > 0 ? job.experienceYears : null;
    const scored = scoreResume(analysis.skills, analysis.candidateYears, requiredYears);
    if (analysis.fallbackReason) log.warn({ reason: analysis.fallbackReason.slice(0, 200) }, "resume got a Quick score");

    const resume = await createResume({
      organizationId: recruiter.organizationId,
      jobId: job.id,
      uploadedById: recruiter.id,
      fileName: upload.name.slice(0, 255),
      fileType: upload.ext,
      fileData: new Uint8Array(upload.buffer),
      resumeText: text,
      name: analysis.candidate,
      summary: analysis.summary,
      candidateYears: analysis.candidateYears,
      requiredYears,
      skills: JSON.parse(JSON.stringify(analysis.skills)),
      score: scored.score,
      reqHit: scored.reqHit,
      reqTotal: scored.reqTotal,
      scoredBy: analysis.model,
    });
    return jsonOk({ resume, notice: analysis.fallbackReason ? "AI unavailable: Quick score used." : null }, 201);
  });
}
