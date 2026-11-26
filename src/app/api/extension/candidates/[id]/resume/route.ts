import { NextResponse } from "next/server";
import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { extractContacts } from "@/server/extension/contacts";
import { extensionRoute } from "@/server/extension/route";
import { MAX_UPLOAD_BYTES, fileToText } from "@/server/files/parse";
import { sniffResume } from "@/server/naukri/resumeFile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/extension/candidates/:id/resume (multipart: file) - stores the CV file with the candidate and reads phone/e-mail from it. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const id = uuidSchema.parse((await context.params).id);
    const candidate = await prisma.candidate.findFirst({
      where: { id, matchScores: { some: { job: { organizationId: recruiter.organizationId } } } },
      select: { id: true, phone: true, emails: true, phoneNumbers: true, resumeText: true },
    });
    if (!candidate) throw new ApiError(404, "Candidate not found.");

    const form = await request.formData().catch(() => {
      throw new ApiError(400, "Upload the CV as multipart form data.");
    });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "No CV file received.");
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "The CV is larger than 10 MB.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const kind = sniffResume(buffer, file.name);
    if (!kind) throw new ApiError(400, "That file is not a PDF/DOC/DOCX (Naukri may have returned a login page).");

    const text = (await fileToText(`resume.${kind}`, buffer).catch(() => "")).slice(0, 200_000) || null;
    const found = extractContacts(text);
    const phone = found.phones[0] ?? null;
    const email = found.emails[0] ?? null;
    const fileName = file.name.replace(/[^\w.\- ]+/g, "").slice(0, 200) || `resume.${kind}`;
    await prisma.candidate.update({
      where: { id },
      data: {
        resumeData: new Uint8Array(buffer),
        resumeFileName: fileName,
        resumeFileType: kind,
        resumeText: text ?? candidate.resumeText,
        resumeCapturedAt: new Date(),
        ...(phone && !candidate.phone ? { phone, phoneSource: "cv", phoneNumbers: [...new Set([...candidate.phoneNumbers, phone])] } : {}),
        ...(email && !candidate.emails.includes(email) ? { emails: [...candidate.emails, email] } : {}),
      },
    });
    return NextResponse.json({ resume: { fileName }, phone: candidate.phone ?? phone, email: candidate.emails[0] ?? email, phoneFromCv: Boolean(phone && !candidate.phone) });
  });
}
