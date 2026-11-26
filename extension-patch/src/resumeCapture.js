/**
 * FIX: "resume links go to a 404".
 *
 * Root cause: Naukri CV URLs only work with the recruiter's live Resdex session. Saving the URL in another system
 * (the web platform) always ends in a 404 / login page. So we never save the link: while the profile is open in
 * Resdex we download the CV WITH the session, validate that it really is a document, and upload the bytes.
 * If the file cannot be fetched we fall back to the CV text so something always reaches the platform.
 */
const MAGIC = [
  { type: "pdf", mime: "application/pdf", test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { type: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", test: (b) => b[0] === 0x50 && b[1] === 0x4b },
  { type: "doc", mime: "application/msword", test: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 },
];

/** Returns the document type when the bytes are a PDF/DOC/DOCX, else null (an HTML login page is NOT accepted). */
export function sniff(bytes) {
  return MAGIC.find((entry) => entry.test(bytes)) ?? null;
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Candidate CV URLs on a profile page, best first: embedded viewers, then download links. */
export function findResumeUrls(doc = document) {
  const urls = [];
  for (const element of doc.querySelectorAll("iframe[src], embed[src], object[data]")) urls.push(element.getAttribute("src") ?? element.getAttribute("data"));
  const area = [...doc.querySelectorAll("*")].find((node) => node.children.length < 6 && /attached cv/i.test(node.textContent ?? "") && node.textContent.length < 80)?.closest("section, div") ?? doc;
  for (const element of area.querySelectorAll('a[href*="download" i], a[href*="cv" i], a[download], [class*="download" i] a, a:has(svg)')) urls.push(element.getAttribute("href"));
  return [...new Set(urls.filter((url) => url && !url.startsWith("javascript:") && !url.startsWith("#")))].map((url) => new URL(url, doc.location?.href ?? "https://resdex.naukri.com").href);
}

/** The visible CV text, used when no file could be downloaded. */
export function readResumeText(doc = document) {
  const heading = [...doc.querySelectorAll("*")].find((node) => node.children.length < 4 && /^attached cv$/i.test(node.textContent?.trim() ?? ""));
  const container = heading?.closest("section, div")?.parentElement ?? null;
  const text = container?.innerText?.replace(/\n{3,}/g, "\n\n").trim() ?? "";
  return text.length > 200 ? text.slice(0, 150_000) : null;
}

/**
 * Downloads the CV with the recruiter's cookies. Returns { resume, resumeText, reason }.
 * resume = { base64, fileName, mime } or null; reason explains a null resume (shown in the panel).
 */
export async function captureResume({ doc = document, fetchImpl = fetch, candidateName = "resume" } = {}) {
  const resumeText = readResumeText(doc);
  for (const url of findResumeUrls(doc)) {
    try {
      const response = await fetchImpl(url, { credentials: "include" });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const kind = sniff(bytes);
      if (!kind || bytes.length > 10 * 1024 * 1024) continue; // login page, error page or too large
      const safe = candidateName.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "resume";
      return { resume: { base64: bytesToBase64(bytes), fileName: `${safe}.${kind.type}`, mime: kind.mime }, resumeText, reason: null };
    } catch {
      /* try the next URL */
    }
  }
  return {
    resume: null,
    resumeText,
    reason: resumeText ? "The CV file could not be downloaded, so the CV text was sent instead." : "No CV found on this page. Open the candidate's profile and wait for the CV to load, then save again.",
  };
}
