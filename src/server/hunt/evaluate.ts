import { scoreCandidate, type ScoringJob } from "@/server/ai/heuristic";
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
 * The score is the weighted mean over the dimensions that have evidence; `evidenceCoverage` says how much of the rubric that was.
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

export function evaluateCandidate(job: ScoringJob, rubric: RubricData, facts: CandidateFacts): EvaluationResult {
  const get = (key: DimensionKey) => rubric.dimensions.find((d) => d.key === key)!;
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
  const scoringJob: ScoringJob = { ...job, requiredSkills: must, preferredSkills: skillsCfg.nice ?? job.preferredSkills };
  const heur = scoreCandidate(scoringJob, profileText, { model: "xs-hunt" });
  const hasText = text.replace(/\s+/g, "").length > 80 || facts.skills.length > 0;

  const dims: Record<string, DimensionResult> = {};

  // 1. Skills
  const sk = get("skills");
  if (must.length + (skillsCfg.nice ?? []).length === 0) dims.skills = dimension(sk, null, "skipped", "The rubric lists no skills to compare.");
  else if (!hasText) dims.skills = dimension(sk, null, "missing", "The profile shows no skills yet.");
  else {
    const score = clamp(heur.breakdown.skills);
    dims.skills = dimension(sk, score, score >= 50 ? "confirmed" : "mismatch",
      heur.matchedSkills.length ? `Evidence of ${heur.matchedSkills.slice(0, 6).join(", ")}${heur.missingSkills.length ? `; no evidence of ${heur.missingSkills.slice(0, 4).join(", ")}` : ""}.` : `No evidence of ${heur.missingSkills.slice(0, 4).join(", ") || "the required skills"}.`,
      heur.matchedSkills.slice(0, 8));
  }

  // 2. Experience
  const ex = get("experience");
  const minY = ex.config.minYears ?? null;
  if (minY === null) dims.experience = dimension(ex, null, "skipped", "The rubric sets no experience requirement.");
  else if (facts.expYears === null) dims.experience = dimension(ex, null, "missing", "Years of experience are not stated.");
  else {
    const ratio = facts.expYears / minY;
    const over = ex.config.maxYears && facts.expYears > ex.config.maxYears ? Math.max(70, 100 - (facts.expYears - ex.config.maxYears) * 5) : 100;
    const score = ratio >= 1 ? over : clamp(100 * Math.pow(ratio, 1.5));
    dims.experience = dimension(ex, score, score >= 60 ? "confirmed" : "mismatch", `${facts.expYears} years against ${minY}+ required.`, [`${facts.expYears} years`]);
  }

  // 3. Compensation: an unknown expectation is missing information, never a failure.
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
    // Only the CURRENT CTC is known. Being above budget is a flag, not proof of a mismatch: expectations are often lower than current pay.
    const score = cur <= max ? 85 : cur <= max * 1.25 ? 60 : 40;
    dims.compensation = dimension(co, score, score >= 55 ? "confirmed" : "mismatch", `Current CTC ${cur} LPA${cur > max ? " is above the budget" : ""} (expected CTC not stated) against a ${max} LPA budget.`, [`${cur} LPA current`]);
  }

  // 4. Availability
  const av = get("availability");
  const maxNotice = av.config.maxNoticeDays ?? null;
  if (maxNotice === null) dims.availability = dimension(av, null, "skipped", "No notice-period limit is set.");
  else if (facts.noticeDays === null) dims.availability = dimension(av, null, "missing", "Notice period is not stated.");
  else {
    const score = facts.noticeDays <= maxNotice ? 100 : facts.noticeDays <= maxNotice + 30 ? 60 : 25;
    dims.availability = dimension(av, score, score >= 60 ? "confirmed" : "mismatch", `${facts.noticeDays === 0 ? "Immediate" : `${facts.noticeDays} days`} notice against a ${maxNotice}-day limit.`, [`${facts.noticeDays} days notice`]);
  }

  // 5. Location
  const lo = get("location");
  const wanted = lo.config.locations ?? [];
  const where = [facts.location, facts.prefLocations].filter(Boolean).join(", ");
  if (wanted.length === 0) dims.location = dimension(lo, null, "skipped", "The job names no location.");
  else if (!where) dims.location = dimension(lo, null, "missing", "Location is not stated.");
  else if (locationMatches(where, wanted)) dims.location = dimension(lo, 100, "confirmed", `Based in or open to ${wanted.join(" / ")}.`, [where]);
  else if (lo.config.remote) dims.location = dimension(lo, 85, "confirmed", "Elsewhere, but the role allows remote work.", [where]);
  else dims.location = dimension(lo, 25, "mismatch", `Located in ${where}; the job is in ${wanted.join(" / ")}.`, [where]);

  // 6. Education
  const ed = get("education");
  const req = ed.config.required ?? [];
  if (req.length === 0) dims.education = dimension(ed, null, "skipped", "The rubric requires no specific education.");
  else if (!facts.education) dims.education = dimension(ed, null, "missing", "Education is not shown.");
  else {
    const ok = req.some((r) => low(facts.education).includes(low(r).replace(/\./g, "")) || low(facts.education).replace(/\./g, "").includes(low(r).replace(/\./g, "")));
    dims.education = dimension(ed, ok ? 100 : 30, ok ? "confirmed" : "mismatch", ok ? `Education matches ${req.join(" / ")}.` : `Education (${facts.education.slice(0, 80)}) does not show ${req.join(" / ")}.`, [facts.education.slice(0, 80)]);
  }

  // 7. Career background: target titles, industry and demonstrated impact.
  const ca = get("career");
  if (!hasText && !headline) dims.career = dimension(ca, null, "missing", "Too little career information is shown.");
  else {
    const titles = ca.config.targetTitles ?? [];
    const titleHit = titles.some((t) => t && low(headline + " " + facts.role).includes(low(t).split(" ").slice(-2).join(" ")));
    const score = clamp(0.4 * (titleHit ? 100 : 40) + 0.3 * heur.breakdown.industry + 0.3 * heur.breakdown.impact);
    dims.career = dimension(ca, score, score >= 40 ? "confirmed" : "mismatch", titleHit ? `Current role (${headline || "n/a"}) is close to the target title.` : `Current role (${headline || "n/a"}) is not an exact match for ${titles[0] ?? "the target title"}.`, headline ? [headline] : []);
  }

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

  // Score: weighted mean over dimensions that have evidence.
  const active = Object.values(dims).filter((d) => d.weight > 0 && d.status !== "skipped");
  const known = active.filter((d) => d.score !== null);
  const knownWeight = known.reduce((s, d) => s + d.weight, 0);
  const totalWeight = active.reduce((s, d) => s + d.weight, 0);
  let total = knownWeight > 0 ? known.reduce((s, d) => s + d.weight * (d.score ?? 0), 0) / knownWeight : 0;
  // Quality gate (unchanged from the existing scorer): without half of the must-have skills a candidate cannot look strong.
  if (must.length > 0 && heur.mustHaveCoverage < 0.5 && dims.skills?.status !== "missing") total = Math.min(total, heur.mustHaveCoverage === 0 ? 45 : 70);
  total = clamp(total);

  const evidenceCoverage = totalWeight > 0 ? Math.round((knownWeight / totalWeight) * 100) / 100 : 0;
  const band = total >= STRONG_AT ? "strong" : total >= POTENTIAL_AT ? "potential" : "weak";
  const tier: Tier = evidenceCoverage < NEEDS_INFO_BELOW ? "needs_info" : evidenceCoverage < PROVISIONAL_BELOW ? "provisional" : band;

  const entries = Object.entries(dims);
  const label = (key: string) => (key.startsWith("custom_") ? rubric.custom[Number(key.slice(7))]?.name ?? key : DIMENSION_LABEL[key as DimensionKey]);
  return {
    total,
    band,
    tier,
    evidenceCoverage,
    dimensions: dims,
    strengths: entries.filter(([, d]) => d.status === "confirmed" && (d.score ?? 0) >= 75).map(([k, d]) => `${label(k)}: ${d.note}`).slice(0, 5),
    concerns: entries.filter(([, d]) => d.status === "mismatch").map(([k, d]) => `${label(k)}: ${d.note}`).slice(0, 5),
    missingInfo: entries.filter(([, d]) => d.status === "missing").map(([k]) => label(k)),
    matchedSkills: heur.matchedSkills,
    missingSkills: heur.missingSkills,
    mustHaveCoverage: heur.mustHaveCoverage,
  };
}
