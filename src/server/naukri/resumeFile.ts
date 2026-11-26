import { fileExtension } from "@/server/files/parse";

export type ResumeKind = "pdf" | "docx" | "doc" | "txt" | "rtf";

/**
 * Checks the first bytes so we never store a Naukri LOGIN PAGE (HTML) saved as "resume.pdf" - the usual result of
 * downloading a CV without the recruiter's session. Returns the real type, or null when the bytes are not a resume.
 */
export function sniffResume(buffer: Buffer, fileName: string): ResumeKind | null {
  const head = buffer.subarray(0, 8);
  if (head.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b) return "docx"; // zip container
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return "doc";
  if (head.subarray(0, 5).toString("latin1") === "{\\rtf") return "rtf";
  const ext = fileExtension(fileName);
  if (ext === "txt") {
    const sample = buffer.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
    if (sample.startsWith("<!doctype") || sample.startsWith("<html")) return null;
    return "txt";
  }
  return null;
}
