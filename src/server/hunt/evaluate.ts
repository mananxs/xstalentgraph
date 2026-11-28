import { scoreCandidate, textHasSkill, type ScoringJob } from "@/server/ai/heuristic";
import { DIMENSION_LABEL, type CustomCriterion, type DimensionKey, type RubricData, type RubricDimension } from "./rubric";
import type { Tier } from "./stages";

/**
 * Standard evaluation engine of XS-Hunt: seven weighted dimensions plus optional custom criteria.
 *
 * Missing information is NOT a failure. Every dimension is classified as
 *   confirmed  - the profile gives real evidence and it fits,
 *   mismatch   - the profile gives real evidence and it does NOT fit,
 *   missing    - the profile does not say (excluded from the score, listed under "missing information"),
 *   skipped    - the rubric has nothing to compare against (no budget set, no education required ...).
 * The score is the weighted mean over ALL the rubric's scored factors, and a factor with no evidence earns nothing: one strong match
 * (say a perfect job title) can never make a candidate look like a perfect fit while everything else is unknown.
 * `evidenceCoverage` says how much of the rubric the profile actually proves, and it sets the tier ("Provisional" / "Needs more info").
 */
export interface CandidateFacts {
  name?: string;
  headline?: string;
  role?: string;
  company?: string;
  skills: string[];
  expYears: number | null;
  currentCtcLpa: number | null;
  expectedCtcLpa: number | null;
  noticeDays: number | null;
  location?: string;
  prefLocations?: string;
  education?: string;
  /** Free text of the card / profile / CV (contact details already removed by the caller when sent to an AI). */
  text: string;
}

export type DimensionStatus = "confirmed" | "mismatch" | "missing" | "skipped";
export interface DimensionResult {
  score: number | null;
  weight: number;
  status: DimensionStatus;
  evidence: string[];
  note: string;
}
export interface EvaluationResult {
  total: number;
  band: "strong" | "potential" | "weak";
  tier: Tier;
  evidenceCoverage: number;
  dimensions: Record<string, DimensionResult>;
  strengths: string[];
  concerns: string[];
  missingInfo: string[];
  matchedSkills: string[];
  missingSkills: string[];
  mustHaveCoverage: number;
}

export const STRONG_AT = 75;
export const POTENTIAL_AT = 55;
/** Below this share of the rubric backed by evidence the tier is "needs more info"; below PROVISIONAL_BELOW it is "provisional". */
export const NEEDS_INFO_BELOW = 0.4;
export const PROVISIONAL_BELOW = 0.7;

const low = (value: string | undefined) => (value ?? "").toLowerCase();
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const CITY_ALIAS: Record<string, string> = { bangalore: "bengaluru", gurgaon: "gurugram", bombay: "mumbai", "new delhi": "delhi" };
const city = (value: string) => { const v = value.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim(); return CITY_ALIAS[v] ?? v; };

function locationMatches(candidate: string, wanted: string[]): boolean {
  const places = candidate.split(/[,/|]+/).map(city).filter(Boolean);
  const targets = wanted.map(city).filter(Boolean);
  return places.some((place) => targets.some((target) => place.includes(target) || target.includes(place)));
}

function dimension(base: RubricDimension, score: number | null, status: DimensionStatus, note: string, evidence: string[] = []): DimensionResult {
  return { score, weight: base.enabled ? base.weight : 0, status, note, evidence };
}

const ACTION = /\b(built|developed|designed|implemented|led|architected|migrated|delivered|launched|created|optimi[sz]ed|reduced|improved|increased|managed|deployed|automated|integrated|owned|scaled|project)\b/i;
const GENERIC_TITLE_WORDS = new Set(["senior", "junior", "lead", "principal", "staff", "sr", "jr", "and", "the", "of", "at", "for", "manager", "engineer", "developer"]);

/** How closely a role text matches a target job title: the share of the title's meaningful words (and its last two words) present. */
function titleRelevance(roleText: string, titles: string[]): number | null {
  const hay = low(roleText);
  if (!hay.trim() || titles.length === 0) return null;
  let best = 0;
  for (const title of titles) {
    const words = low(title).split(/[^a-z0-9+#.]+/).filter((w) => w.length >= 2);
    if (!words.length) continue;
    const key = words.filter((w) => !GENERIC_TITLE_WORDS.has(w));
    const pool = key.length ? key : words;
    const hit = pool.filter((w) => hay.includes(w)).length / pool.length;
    const generic = words.filter((w) => GENERIC_TITLE_WORDS.has(w) && hay.includes(w)).length > 0 ? 0.1 : 0;
    best = Math.max(best, Math.min(1, hit * 0.9 + generic));
  }
  return clamp(best * 100);
}

export function evaluateCandidate(job: ScoringJob, rubric: RubricData, facts: CandidateFacts): EvaluationResult {
  const get = (key: DimensionKey): RubricDimension => rubric.dimensions.find((d) => d.key === key) ?? { key, label: DIMENSION_LABEL[key], weight: 0, enabled: false, config: {} };
  const text = facts.text;
  const headline = facts.headline ?? ([facts.role, facts.company].filter(Boolean).join(" at ") || "");
  const profileText = [
    headline && `Headline: ${headline}`,
    facts.location && `Location: ${facts.location}`,
    facts.skills.length > 0 && `Skills: ${facts.skills.join(", ")}`,
    facts.expYears !== null && `Experience: ${facts.expYears} years`,
    `Bio: ${text.replace(/\s+/g, " ").slice(0, 6000)}`,
  ].filter(Boolean).join("\n");

  const skillsCfg = get("skills").config;
  const must = skillsCfg.mustHave ?? job.requiredSkills;
  const nice = skillsCfg.nice ?? job.preferredSkills;
  const scoringJob: ScoringJob = { ...job, requiredSkills: must, preferredSkills: nice };
  const heur = scoreCandidate(scoringJob, profileText, { model: "xs-hunt" });
  const hasText = text.replace(/\s+/g, "").length > 80 || facts.skills.length > 0;
  const hay = `${profileText}\n${text}`;
  const coverage = (list: string[]) => (list.length ? list.filter((t) => textHasSkill(hay, t)).length / list.length : null);

  const dims: Record<string, DimensionResult> = {};

  // 1. Technical skills match
  const sk = get("skills");
  if (must.length + nice.length === 0) dims.skills = dimension(sk, null, "skipped", "The rubric lists no skills to compare.");
  else if (!hasText) dims.skills = dimension(sk, null, "missing", "The profile shows no skills yet.");
  else {
    const score = clamp(heur.breakdown.skills);
    dims.skills = dimension(sk, score, score >= 50 ? "confirmed" : "mismatch",
      heur.matchedSkills.length ? `Evidence of ${heur.matchedSkills.slice(0, 6).join(", ")}${heur.missingSkills.length ? `; no evidence of ${heur.missingSkills.slice(0, 4).join(", ")}` : ""}.` : `No evidence of ${heur.missingSkills.slice(0, 4).join(", ") || "the required skills"}.`,
      heur.matchedSkills.slice(0, 8));
  }

  // 2. Relevant work experience: years against the requirement AND how relevant the roles are to this job.
  const ex = get("experience");
  const minY = ex.config.minYears ?? null;
  const titles = (ex.config.targetTitles ?? []).filter(Boolean);
  const yearsScore = minY === null || facts.expYears === null ? null : (() => {
    const ratio = facts.expYears / minY;
    const over = ex.config.maxYears && facts.expYears > ex.config.maxYears ? Math.max(70, 100 - (facts.expYears - ex.config.maxYears) * 5) : 100;
    return ratio >= 1 ? over : clamp(100 * Math.pow(ratio, 1.5));
  })();
  const roleText = [headline, facts.role].filter(Boolean).join(" ");
  const roleScore = titleRelevance(roleText, titles);
  if (minY === null && titles.length === 0) dims.experience = dimension(ex, null, "skipped", "The rubric sets no experience requirement.");
  else if (yearsScore === null && roleScore === null) dims.experience = dimension(ex, null, "missing", "Years of experience and current role are not stated.");
  else {
    const score = yearsScore !== null && roleScore !== null ? clamp(0.6 * yearsScore + 0.4 * roleScore) : (yearsScore ?? roleScore)!;
    const parts = [yearsScore !== null ? `${facts.expYears} years against ${minY}+ required` : "years not stated", roleScore !== null ? `current role (${headline || facts.role || "n/a"}) is ${roleScore >= 70 ? "close to" : roleScore >= 40 ? "partly related to" : "not related to"} ${titles[0] ?? "the target role"}` : "role not stated"];
    dims.experience = dimension(ex, score, score >= 60 ? "confirmed" : "mismatch", `${parts[0]}; ${parts[1]}.`, [facts.expYears !== null ? `${facts.expYears} years` : "", headline].filter(Boolean));
  }

  // 3. Project relevance: projects and achievements described, and how many of them touch this job's skills.
  const pr = get("projects");
  const jobSkills = [...must, ...nice, ...(get("tools").config.tools ?? [])];
  const lines = text.split(/\n+|(?<=[.!?])\s+/).map((l) => l.trim()).filter((l) => l.length >= 25 && ACTION.test(l));
  if (!hasText || lines.length === 0) dims.projects = dimension(pr, null, "missing", "No projects or achievements are described yet (open the full profile or CV).");
  else {
    const relevant = jobSkills.length ? lines.filter((l) => jobSkills.some((k) => textHasSkill(l, k))).length / lines.length : null;
    const volume = Math.min(1, lines.length / 3);
    const impact = heur.breakdown.impact / 100;
    const score = clamp(100 * (relevant === null ? 0.5 * volume + 0.5 * impact : 0.5 * relevant + 0.25 * volume + 0.25 * impact));
    dims.projects = dimension(pr, score, score >= 50 ? "confirmed" : "mismatch",
      `${lines.length} project / achievement line${lines.length === 1 ? "" : "s"}${relevant !== null ? `, ${Math.round(relevant * 100)}% touch the job's skills` : ""}${impact >= 0.5 ? ", with measurable results" : ""}.`, lines.slice(0, 2).map((l) => l.slice(0, 120)));
  }

  // 4. Required qualifications / education
  const ed = get("education");
  const req = ed.config.required ?? [];
  if (req.length === 0) dims.education = dimension(ed, null, "skipped", "The rubric requires no specific education.");
  else if (!facts.education) dims.education = dimension(ed, null, "missing", "Education is not shown.");
  else {
    const ok = req.some((r) => low(facts.education).includes(low(r).replace(/\./g, "")) || low(facts.education).replace(/\./g, "").includes(low(r).replace(/\./g, "")));
    dims.education = dimension(ed, ok ? 100 : 30, ok ? "confirmed" : "mismatch", ok ? `Education matches ${req.join(" / ")}.` : `Education (${facts.education.slice(0, 80)}) does not show ${req.join(" / ")}.`, [facts.education.slice(0, 100)]);
  }

  // 5. Tools, technologies & frameworks
  const tl = get("tools");
  const tools = tl.config.tools ?? [];
  if (tools.length === 0) dims.tools = dimension(tl, null, "skipped", "The rubric lists no extra tools or frameworks.");
  else if (!hasText) dims.tools = dimension(tl, null, "missing", "The profile shows no tools yet.");
  else {
    const cov = coverage(tools) ?? 0;
    const hit = tools.filter((t) => textHasSkill(hay, t));
    dims.tools = dimension(tl, clamp(cov * 100), cov >= 0.5 ? "confirmed" : "mismatch", hit.length ? `Shows ${hit.slice(0, 6).join(", ")}${hit.length < tools.length ? `; not shown: ${tools.filter((t) => !hit.includes(t)).slice(0, 4).join(", ")}` : ""}.` : `None of ${tools.slice(0, 4).join(", ")} shown.`, hit.slice(0, 8));
  }

  // 6. Keywords & ATS compatibility
  const kw = get("keywords");
  const kws = kw.config.keywords ?? [];
  if (kws.length === 0) dims.keywords = dimension(kw, null, "skipped", "No keywords are set.");
  else if (!hasText) dims.keywords = dimension(kw, null, "missing", "The profile has too little text to check keywords.");
  else {
    const cov = coverage(kws) ?? 0;
    dims.keywords = dimension(kw, clamp(cov * 100), cov >= 0.4 ? "confirmed" : "mismatch", `${Math.round(cov * kws.length)} of ${kws.length} job keywords appear in the profile.`, kws.filter((k) => textHasSkill(hay, k)).slice(0, 8));
  }

  // 7. Domain / industry knowledge
  const dm = get("domain");
  const inds = dm.config.industries ?? [];
  if (!hasText && !headline) dims.domain = dimension(dm, null, "missing", "Too little information to judge domain experience.");
  else if (inds.length > 0) {
    const cov = inds.filter((i) => hasWord(hay, i)).length / inds.length;
    dims.domain = dimension(dm, clamp(cov * 100), cov >= 0.5 ? "confirmed" : "mismatch", cov > 0 ? `Shows ${inds.filter((i) => hasWord(hay, i)).join(", ")} experience.` : `No sign of ${inds.join(", ")}.`, inds.filter((i) => hasWord(hay, i)));
  } else {
    const score = clamp(heur.breakdown.industry);
    dims.domain = dimension(dm, score, score >= 40 ? "confirmed" : "mismatch", score >= 40 ? "Background fits the job's industry." : "Little sign of this job's industry or domain.", []);
  }

  // Optional fit flags (weight 0 unless the recruiter gives them one): compensation, notice period, location.
  const co = get("compensation");
  const max = co.config.maxLpa ?? null;
  if (max === null) dims.compensation = dimension(co, null, "skipped", "No compensation budget is set for this job.");
  else if (facts.expectedCtcLpa === null && facts.currentCtcLpa === null) dims.compensation = dimension(co, null, "missing", "Current and expected CTC are not stated.");
  else if (facts.expectedCtcLpa !== null) {
    const over = facts.expectedCtcLpa / max;
    const score = over <= 1 ? 100 : over <= 1.2 ? 60 : 20;
    dims.compensation = dimension(co, score, score >= 60 ? "confirmed" : "mismatch", `Expects ${facts.expectedCtcLpa} LPA against a ${max} LPA budget.`, [`${facts.expectedCtcLpa} LPA expected`]);
  } else {
    const cur = facts.currentCtcLpa!;
    const score = cur <= max ? 85 : cur <= max * 1.25 ? 60 : 40;
    dims.compensation = dimension(co, score, score >= 55 ? "confirmed" : "mismatch", `Current CTC ${cur} LPA${cur > max ? " is above the budget" : ""} (expected CTC not stated) against a ${max} LPA budget.`, [`${cur} LPA current`]);
  }
  const av = get("availability");
  const maxNotice = av.config.maxNoticeDays ?? null;
  if (maxNotice === null) dims.availability = dimension(av, null, "skipped", "No notice-period limit is set.");
  else if (facts.noticeDays === null) dims.availability = dimension(av, null, "missing", "Notice period is not stated.");
  else {
    const score = facts.noticeDays <= maxNotice ? 100 : facts.noticeDays <= maxNotice + 30 ? 60 : 25;
    dims.availability = dimension(av, score, score >= 60 ? "confirmed" : "mismatch", `${facts.noticeDays === 0 ? "Immediate" : `${facts.noticeDays} days`} notice against a ${maxNotice}-day limit.`, [`${facts.noticeDays} days notice`]);
  }
  const lo = get("location");
  const wanted = lo.config.locations ?? [];
  const where = [facts.location, facts.prefLocations].filter(Boolean).join(", ");
  if (wanted.length === 0) dims.location = dimension(lo, null, "skipped", "The job names no location.");
  else if (!where) dims.location = dimension(lo, null, "missing", "Location is not stated.");
  else if (locationMatches(where, wanted)) dims.location = dimension(lo, 100, "confirmed", `Based in or open to ${wanted.join(" / ")}.`, [where]);
  else if (lo.config.remote) dims.location = dimension(lo, 85, "confirmed", "Elsewhere, but the role allows remote work.", [where]);
  else dims.location = dimension(lo, 25, "mismatch", `Located in ${where}; the job is in ${wanted.join(" / ")}.`, [where]);

  // Custom criteria
  rubric.custom.forEach((c: CustomCriterion, index) => {
    const base: RubricDimension = { key: "skills", label: c.name, weight: c.weight, enabled: true, config: {} };
    if (!hasText) {
      dims[`custom_${index}`] = dimension(base, null, "missing", `No information to check "${c.name}".`);
    } else {
      const hits = c.keywords.filter((k) => low(text).includes(low(k)));
      const score = clamp((100 * hits.length) / c.keywords.length);
      dims[`custom_${index}`] = dimension(base, score, hits.length > 0 ? "confirmed" : "mismatch", hits.length ? `Shows ${hits.join(", ")}.` : `No evidence of ${c.keywords.join(", ")}.`, hits);
    }
  });

  return finish(dims, rubric, { matchedSkills: heur.matchedSkills, missingSkills: heur.missingSkills, mustHaveCoverage: heur.mustHaveCoverage, mustCount: must.length });
}

const hasWord = (haystack: string, term: string) => new RegExp(`(?<![a-z0-9])${term.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i").test(haystack);

/**
 * Turns per-dimension results into the total, tier and notes. ONE place, used by the rule engine and the AI judge, so a score means the
 * same thing whichever produced it:
 *   total = sum(weight x score) / sum(weight) over every SCORED factor the rubric applies; a factor with no evidence earns 0.
 * (Factors the rubric has nothing to compare, "skipped", are left out of both sides.)
 */
export function finish(dims: Record<string, DimensionResult>, rubric: RubricData, info: { matchedSkills: string[]; missingSkills: string[]; mustHaveCoverage: number; mustCount: number }): EvaluationResult {
  const active = Object.values(dims).filter((d) => d.weight > 0 && d.status !== "skipped");
  const known = active.filter((d) => d.score !== null);
  const knownWeight = known.reduce((s, d) => s + d.weight, 0);
  const totalWeight = active.reduce((s, d) => s + d.weight, 0);
  let total = totalWeight > 0 ? known.reduce((s, d) => s + d.weight * (d.score ?? 0), 0) / totalWeight : 0;
  // Quality gate: without half of the must-have skills a candidate cannot look strong.
  if (info.mustCount > 0 && info.mustHaveCoverage < 0.5 && dims.skills?.status !== "missing") total = Math.min(total, info.mustHaveCoverage === 0 ? 45 : 70);
  total = clamp(total);

  const evidenceCoverage = totalWeight > 0 ? Math.round((knownWeight / totalWeight) * 100) / 100 : 0;
  const band = total >= STRONG_AT ? "strong" : total >= POTENTIAL_AT ? "potential" : "weak";
  const tier: Tier = evidenceCoverage < NEEDS_INFO_BELOW ? "needs_info" : evidenceCoverage < PROVISIONAL_BELOW ? "provisional" : band;

  const entries = Object.entries(dims);
  const label = (key: string) => (key.startsWith("custom_") ? rubric.custom[Number(key.slice(7))]?.name ?? key : DIMENSION_LABEL[key as DimensionKey] ?? key);
  const flag = (d: DimensionResult) => (d.weight === 0 ? " (flag only, not scored)" : "");
  return {
    total,
    band,
    tier,
    evidenceCoverage,
    dimensions: dims,
    strengths: entries.filter(([, d]) => d.status === "confirmed" && (d.score ?? 0) >= 75 && d.weight > 0).map(([k, d]) => `${label(k)}: ${d.note}`).slice(0, 5),
    concerns: entries.filter(([, d]) => d.status === "mismatch").map(([k, d]) => `${label(k)}: ${d.note}${flag(d)}`).slice(0, 5),
    missingInfo: entries.filter(([, d]) => d.status === "missing" && d.weight > 0).map(([k]) => label(k)),
    matchedSkills: info.matchedSkills,
    missingSkills: info.missingSkills,
    mustHaveCoverage: info.mustHaveCoverage,
  };
}
