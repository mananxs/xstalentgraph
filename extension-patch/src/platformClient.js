/**
 * Talks to the TalentGraph platform. Runs in the extension's BACKGROUND service worker (never in the page), so
 * http://localhost and https://your-domain both work and Naukri's page CSP / mixed-content rules do not apply.
 * The functions take `fetchImpl` so they can also be run from Node for tests.
 */
export function base64ToBlob(base64, mime = "application/octet-stream") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const headers = (apiKey) => ({ Authorization: `Bearer ${apiKey}` });
const trim = (url) => url.replace(/\/+$/, "");

async function parse(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? `Platform answered ${response.status}`);
  return body;
}

export async function ping({ platformUrl, apiKey, fetchImpl = fetch }) {
  return parse(await fetchImpl(`${trim(platformUrl)}/api/ext/ping`, { headers: headers(apiKey) }));
}

export async function listJobs({ platformUrl, apiKey, fetchImpl = fetch }) {
  return (await parse(await fetchImpl(`${trim(platformUrl)}/api/ext/jobs`, { headers: headers(apiKey) }))).jobs;
}

/**
 * Saves a shortlisted card.
 * @param shortlist { job, candidate, analysis, resumeText? }  see src/server/naukri/schema.ts on the platform
 * @param resume    { base64, fileName, mime } | null          the downloaded CV (optional)
 * @returns {candidateId, resume: "file"|"text"|"none", resumeWarning, profilePath, ...}
 */
export async function saveShortlist({ platformUrl, apiKey, fetchImpl = fetch }, shortlist, resume = null) {
  const url = `${trim(platformUrl)}/api/ext/shortlist`;
  if (resume?.base64) {
    const form = new FormData();
    form.append("payload", JSON.stringify({ ...shortlist, resumeFileName: resume.fileName }));
    form.append("resume", base64ToBlob(resume.base64, resume.mime), resume.fileName || "resume.pdf");
    return parse(await fetchImpl(url, { method: "POST", headers: headers(apiKey), body: form }));
  }
  return parse(await fetchImpl(url, { method: "POST", headers: { ...headers(apiKey), "Content-Type": "application/json" }, body: JSON.stringify(shortlist) }));
}
