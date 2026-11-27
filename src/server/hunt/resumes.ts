import { createHash } from "node:crypto";
import { prisma } from "@/server/db";

/**
 * Stores an original resume file for a candidate. The same file is never stored twice for one candidate (sha256).
 * The legacy columns on `candidates` are kept in step so older readers keep working.
 */
export async function storeResumeFile(p: {
  organizationId: string;
  candidateId: string;
  buffer: Buffer;
  fileName: string;
  fileType: string;
  text: string | null;
  origin?: string;
  actorId?: string | null;
}): Promise<{ id: string; duplicate: boolean }> {
  const sha256 = createHash("sha256").update(p.buffer).digest("hex");
  const existing = await prisma.candidateResume.findUnique({ where: { candidateId_sha256: { candidateId: p.candidateId, sha256 } }, select: { id: true } });
  if (existing) return { id: existing.id, duplicate: true };
  const row = await prisma.candidateResume.create({
    data: {
      organizationId: p.organizationId,
      candidateId: p.candidateId,
      fileName: p.fileName,
      fileType: p.fileType,
      sizeBytes: p.buffer.length,
      sha256,
      data: new Uint8Array(p.buffer),
      text: p.text,
      origin: p.origin ?? "naukri",
      capturedById: p.actorId ?? null,
    },
    select: { id: true },
  });
  await prisma.candidate.update({
    where: { id: p.candidateId },
    data: { resumeData: new Uint8Array(p.buffer), resumeFileName: p.fileName, resumeFileType: p.fileType, resumeText: p.text ?? undefined, resumeCapturedAt: new Date() },
  });
  return { id: row.id, duplicate: false };
}

export async function latestResume(candidateId: string, organizationId: string) {
  return prisma.candidateResume.findFirst({ where: { candidateId, organizationId }, orderBy: { createdAt: "desc" } });
}
