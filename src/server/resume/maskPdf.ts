import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** Helvetica only knows WinAnsi characters: replace everything else so drawing never throws. */
const safe = (text: string) =>
  text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, " ")
    .replace(/[^\x09\x0A\x20-\x7E\xA1-\xFF•–—€]/g, "?");

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** Renders masked resume text into a clean ATS-style PDF, optionally watermarked. */
export async function buildMaskedPdf(text: string, options: { code: string; watermark: boolean; watermarkText: string }): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595;
  const H = 842;
  const M = 50;
  const maxWidth = W - 2 * M;
  const ink = rgb(0.1, 0.1, 0.1);
  const brand = rgb(0.32, 0.36, 0.78);
  const grey = rgb(0.45, 0.45, 0.45);

  let page: PDFPage = doc.addPage([W, H]);
  const pages = [page];
  let y = H - M;
  const ensure = (height: number) => {
    if (y - height < M + 24) {
      page = doc.addPage([W, H]);
      pages.push(page);
      y = H - M;
    }
  };
  const put = (value: string, o: { font?: PDFFont; size?: number; indent?: number; color?: ReturnType<typeof rgb>; gap?: number; bullet?: boolean } = {}) => {
    const { font = regular, size = 10, indent = 0, color = ink, gap = 3.5, bullet = false } = o;
    for (const [index, line] of wrap(value, font, size, maxWidth - indent - (bullet ? 12 : 0)).entries()) {
      ensure(size + gap);
      if (bullet && index === 0) page.drawText("•", { x: M + indent, y: y - size, size, font });
      page.drawText(line, { x: M + indent + (bullet ? 12 : 0), y: y - size, size, font, color });
      y -= size + gap;
    }
  };

  put(safe(options.code), { font: bold, size: 22, color: brand, gap: 6 });
  for (const raw of safe(text).split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      y -= 4;
      continue;
    }
    if (line.startsWith("@ ")) put(line.slice(2), { size: 12, color: grey, gap: 8 });
    else if (line.startsWith("# ")) {
      y -= 8;
      ensure(36);
      put(line.slice(2).toUpperCase(), { font: bold, size: 11, color: brand, gap: 3 });
      page.drawLine({ start: { x: M, y: y + 1 }, end: { x: W - M, y: y + 1 }, thickness: 0.6, color: rgb(0.75, 0.75, 0.8) });
      y -= 5;
    } else if (line.startsWith("## ")) {
      y -= 3;
      put(line.slice(3).replace(/\s*\|\s*/g, "  |  "), { font: bold, size: 10.5 });
    } else if (/^\s*[-•*] /.test(line)) put(line.replace(/^\s*[-•*] /, ""), { bullet: true, indent: 8 });
    else put(line);
  }

  const wmText = safe(options.watermarkText);
  pages.forEach((p, index) => {
    if (options.watermark && wmText) {
      const size = 46;
      const width = bold.widthOfTextAtSize(wmText, size);
      p.drawText(wmText, { x: W / 2 - width / 2, y: H / 2, size, font: bold, color: brand, opacity: 0.08 });
    }
    const footer = `Anonymized resume  ·  ${safe(options.code)}${options.watermark && wmText ? `  ·  ${wmText}` : ""}  ·  Page ${index + 1} of ${pages.length}`;
    p.drawText(footer, { x: M, y: 26, size: 8, font: regular, color: grey });
  });
  return Buffer.from(await doc.save());
}
