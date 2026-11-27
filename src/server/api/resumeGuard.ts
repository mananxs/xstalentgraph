import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { requireRecruiter } from "@/server/auth";
import { findResume } from "@/server/repositories/resumeRepository";

/** Signed-in recruiter + a resume that belongs to their organization (404 otherwise). */
export async function requireResumeAccess(rawId: string) {
  const recruiter = await requireRecruiter();
  const id = uuidSchema.parse(rawId);
  const resume = await findResume(id, recruiter);
  if (!resume) throw new ApiError(404, "Resume not found.");
  return { recruiter, resume };
}
