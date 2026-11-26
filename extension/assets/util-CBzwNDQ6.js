const DEFAULT_SETTINGS = { analyzedOnly: false, autoSync: true, scoring: false };
function worthOf(r) {
  return r.worth ?? (r.score >= 80 ? "open" : r.score >= 60 ? "review" : "skip");
}
const WORTH_LABEL = {
  open: { short: "Worth 1 CV View", long: "High Priority · Open Profile" },
  review: { short: "Review card", long: "Borderline · Review Card First" },
  skip: { short: "Skip", long: "Skip · Save Quota" }
};
const K = {
  config: "config",
  // local
  activeJob: "activeJob",
  // local
  settings: "settings",
  // local — Settings
  platform: "platform",
  // local — PlatformConfig (TalentGraph)
  pending: "pendingResumes",
  // local — cards saved to the platform that still need their CV file
  search: (tabId) => `search:${tabId}`,
  // session — SearchSnapshot
  searchSession: (tabId) => `searchSession:${tabId}`,
  // session — SearchSessionInfo for the applied search
  rank: (tabId) => `rank:${tabId}`,
  // session
  detail: (tabId) => `detail:${tabId}`,
  // session
  focus: (tabId) => `focus:${tabId}`,
  // session
  saved: (tabId) => `saved:${tabId}`,
  // session — SaveMap of cards saved to the shortlist
  queryDraft: (jobId) => `queryDraft:${jobId}`
  // local — recruiter's edited Boolean/exp/location
};
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
}
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function resultMatchesCard(extracted, rawText) {
  if (!extracted) return true;
  const text = ` ${norm(rawText)} `;
  const name = norm(extracted.fullName);
  if (!name) return true;
  const parts = name.split(" ").filter((w) => w.length >= 2);
  if (!parts.length) return true;
  const hit = parts.filter((w) => text.includes(` ${w} `) || text.includes(` ${w}`)).length;
  if (hit / parts.length < 0.6) return false;
  const company = norm(extracted.currentCompany);
  if (company.length >= 4) {
    const words = company.split(" ").filter((w) => w.length >= 3);
    if (words.length && !words.some((w) => text.includes(w))) return false;
  }
  return true;
}
function platformKey(p) {
  const exp = typeof p.expYears === "number" && p.expYears >= 0 ? Math.round(p.expYears) : "x";
  return `xs_${hashStr(`${norm(p.fullName)}|${norm(p.currentCompany)}|${exp}`)}${hashStr(`${exp}|${norm(p.currentCompany)}|${norm(p.fullName)}`)}`;
}
export {
  DEFAULT_SETTINGS as D,
  K,
  WORTH_LABEL as W,
  hashStr as h,
  platformKey as p,
  resultMatchesCard as r,
  worthOf as w
};
