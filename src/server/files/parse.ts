import { getLlmClient } from "@/server/ai/llm";
import { ApiError } from "@/server/api/http";

/** Upload limit for JDs and resumes. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "doc", "txt", "md", "rtf"] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  rtf: "application/rtf",
};

export function fileExtension(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

/** Collapses layout noise from extracted text. */
function clean(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Very small RTF-to-text: drops control words and groups. Good enough for skill matching. */
function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, "\n")
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\'[0-9a-f]{2}/gi, "")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
}

async function pdfToText(buffer: Buffer): Promise<string> {
  let text = "";
  // 1. unpdf (current pdf.js): reads modern PDFs, including compressed object streams.
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = clean(Array.isArray(result.text) ? result.text.join("\n") : result.text);
  } catch {
    text = "";
  }
  // 2. pdf-parse as a second opinion for odd files. Import the inner module: the package index runs a debug
  //    self-test that reads a missing file.
  if (text.length < 200) {
    try {
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (data: Buffer) => Promise<{ text: string }>;
      const parsed = clean((await pdfParse(buffer)).text ?? "");
      if (parsed.length > text.length) text = parsed;
    } catch {
      // keep what we have
    }
  }

  // Scanned / image-only PDFs have (almost) no text layer: let Gemini read the PDF itself.
  if (text.length < 200) {
    const llm = getLlmClient();
    if (llm.configured && !llm.isPaused()) {
      try {
        const { text: ocr } = await llm.generate({
          prompt: "Transcribe ALL text in this document in natural reading order (handle multi-column layouts). Output only the text.",
          pdf: buffer,
          maxOutputTokens: 8000,
        });
        if (clean(ocr).length > text.length) text = clean(ocr);
      } catch {
        // keep whatever the text layer gave us
      }
    }
  }
  return text;
}

/**
 * Turns an uploaded PDF / DOCX / DOC / TXT / MD / RTF into plain text.
 * @throws ApiError(400) with a clear message for unsupported, empty or unreadable files.
 */
export async function fileToText(fileName: string, buffer: Buffer): Promise<string> {
  if (buffer.length === 0) throw new ApiError(400, `${fileName} is empty.`);
  if (buffer.length > MAX_UPLOAD_BYTES) throw new ApiError(400, `${fileName} is larger than 10 MB.`);

  const ext = fileExtension(fileName);
  let text = "";
  try {
    if (ext === "pdf") {
      text = await pdfToText(buffer);
    } else if (ext === "docx") {
      const mammoth = await import("mammoth");
      text = clean((await mammoth.extractRawText({ buffer })).value);
    } else if (ext === "doc") {
      const WordExtractor = (await import("word-extractor")).default as unknown as new () => {
        extract: (input: Buffer) => Promise<{ getBody: () => string }>;
      };
      const document = await new WordExtractor().extract(buffer);
      text = clean(document.getBody());
    } else if (ext === "txt" || ext === "md") {
      text = clean(buffer.toString("utf8"));
    } else if (ext === "rtf") {
      text = clean(rtfToText(buffer.toString("latin1")));
    } else {
      throw new ApiError(400, `${fileName}: unsupported file type. Use PDF, DOC, DOCX or TXT.`);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, `${fileName} could not be read. Is it a valid ${ext.toUpperCase()} file?`);
  }

  if (text.length < 40) {
    throw new ApiError(400, `No readable text found in ${fileName}. If it is a scanned PDF, add GEMINI_API_KEY so it can be read with OCR.`);
  }
  return text.slice(0, 60_000);
}

/** Reads a File from multipart form data into a Buffer, enforcing the size limit. */
export async function readUpload(file: File): Promise<{ name: string; buffer: Buffer; ext: string }> {
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(400, `${file.name} is larger than 10 MB.`);
  const buffer = Buffer.from(await file.arrayBuffer());
  return { name: file.name || "upload", buffer, ext: fileExtension(file.name || "") };
}
