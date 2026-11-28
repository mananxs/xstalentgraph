import type { JobDetails } from "@/server/repositories/jobRepository";

/** The seven standard evaluation dimensions. */
/**
 * The standard rubric (modelled on the usual hiring scorecard): seven SCORED factors that add up to 100, then three optional "fit flags"
 * (compensation, notice period, location) that are shown on every candidate but weigh 0 until a recruiter gives them a weight.
 * It is a standard, not a rule: every weight, target and the on/off switch is editable per job.
 */
export const DIMENSION_KEYS = ["skills", "experience", "projects", "education", "tools", "keywords", "domain", "compensation", "availability", "location"] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DIMENSION_LABEL: Record<DimensionKey, string> = {
  skills: "Technical skills match",
  experience: "Relevant work experience",
  projects: "Project relevance",
  education: "Required qualifications / education",
  tools: "Tools, technologies & frameworks",
  keywords: "Keywords & ATS compatibility",
  domain: "Domain / industry knowledge",
  compensation: "Compensation fit",
  availability: "Availability (notice period)",
  location: "Location fit",
};

/** The keys of the previous rubric format. A rubric that still has "career" is upgraded to the standard one. */
export const LEGACY_KEYS = ["career"] as const;

export interface RubricDimension {
  key: DimensionKey;
  label: string;
  /** Relative weight (any positive number; they are normalised). 0 or enabled=false removes the dimension. */
  weight: number;
  enabled: boolean;
  config: {
    mustHave?: string[];
    nice?: string[];
    minYears?: number | null;
    maxYears?: number | null;
    minLpa?: number | null;
    maxLpa?: number | null;
    maxNoticeDays?: number | null;
    locations?: string[];
    remote?: boolean;
    required?: string[];
    targetTitles?: string[];
    industries?: string[];
    /** Tools, technologies and frameworks the job asks for (beyond the must-have skills). */
    tools?: string[];
    /** Keywords an ATS would look for in the CV. */
    keywords?: string[];
  };
}

export interface CustomCriterion {
  name: string;
  weight: number;
  description?: string;
  /** Words that count as evidence of the criterion in the candidate's text. */
  keywords: string[];
}

export interface RubricData {
  dimensions: RubricDimension[];
  custom: CustomCriterion[];
}

export const DEFAULT_WEIGHTS: Record<DimensionKey, number> = { skills: 30, experience: 25, projects: 15, education: 10, tools: 10, keywords: 5, domain: 5, compensation: 0, availability: 0, location: 0 };
/** Dimensions that count towards the score by default. The others are shown as flags until given a weight. */
export const SCORED_BY_DEFAULT: ReadonlySet<DimensionKey> = new Set(["skills", "experience", "projects", "education", "tools", "keywords", "domain"]);

const EDUCATION_WORDS: Array<[RegExp, string]> = [
  [/\bb\.?\s?tech\b|bachelor of technology/i, "B.Tech"],
  [/\bb\.?\s?e\b|bachelor of engineering/i, "B.E"],
  [/\bm\.?\s?tech\b|master of technology/i, "M.Tech"],
  [/\bmca\b/i, "MCA"],
  [/\bmba\b/i, "MBA"],
  [/\bb\.?\s?sc\b/i, "B.Sc"],
  [/\bbca\b/i, "BCA"],
];

/** Reads budget / notice / education requirements out of the JD text when it states them. Never invents any. */
export function readJdConstraints(text: string): { maxLpa: number | null; maxNoticeDays: number | null; education: string[] } {
  const budget = /(?:up to|upto|budget|ctc)[^\d]{0,15}(\d{1,3}(?:\.\d+)?)\s*(?:-\s*(\d{1,3}(?:\.\d+)?)\s*)?(?:lpa|lacs?|lakhs?)/i.exec(text);
  const notice = /notice(?: period)?[^\d]{0,20}(\d{1,3})\s*days?/i.exec(text) ?? /(immediate)\s*joiner/i.exec(text);
  return {
    maxLpa: budget ? Number(budget[2] ?? budget[1]) : null,
    maxNoticeDays: notice ? (notice[1] === "immediate" || /immediate/i.test(notice[1] ?? "") ? 15 : Number(notice[1])) : null,
    education: EDUCATION_WORDS.filter(([re]) => re.test(text)).map(([, name]) => name),
  };
}

const STOP = new Set(["and", "the", "for", "with", "you", "our", "are", "will", "have", "has", "from", "that", "this", "your", "experience", "years", "year", "work", "team", "ability", "strong", "good", "knowledge", "senior", "junior", "lead"]);

/** Words an ATS would look for: the job title's words plus every skill and technology the JD names. */
function atsKeywords(job: JobDetails): string[] {
  const title = job.title.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set([...job.requiredSkills, ...job.languages, ...job.preferredSkills, ...job.technologies, ...title].map((k) => k.trim()).filter(Boolean))].slice(0, 25);
}

/** The first rubric of a job: the standard factors filled from what the JD says. */
export function defaultRubric(job: JobDetails & { rawText?: string | null }): RubricData {
  const text = `${job.title}\n${job.description}\n${job.rawText ?? ""}`;
  const c = readJdConstraints(text);
  const years = job.experienceYears && job.experienceYears > 0 ? job.experienceYears : null;
  const must = [...new Set([...job.requiredSkills, ...job.languages])];
  const lower = new Set(must.map((m) => m.toLowerCase()));
  const tools = [...new Set([...job.technologies, ...job.handsOn, ...job.preferredSkills].map((t) => t.trim()).filter((t) => t && !lower.has(t.toLowerCase())))].slice(0, 20);
  const config: Record<DimensionKey, RubricDimension["config"]> = {
    skills: { mustHave: must, nice: job.preferredSkills },
    experience: { minYears: years, maxYears: years ? years + 5 : null, targetTitles: [job.title] },
    projects: {},
    education: { required: c.education },
    tools: { tools },
    keywords: { keywords: atsKeywords(job) },
    domain: { industries: [] },
    compensation: { minLpa: null, maxLpa: c.maxLpa },
    availability: { maxNoticeDays: c.maxNoticeDays ?? 60 },
    location: { locations: job.locations, remote: job.remoteAllowed },
  };
  return {
    dimensions: DIMENSION_KEYS.map((key) => ({ key, label: DIMENSION_LABEL[key], weight: DEFAULT_WEIGHTS[key], enabled: SCORED_BY_DEFAULT.has(key), config: config[key] })),
    custom: [],
  };
}

/** True when a stored rubric is in the previous format (it has "career" or lacks the standard factors). */
export const isLegacyRubric = (data: RubricData): boolean => !Array.isArray(data.dimensions) || data.dimensions.some((d) => (LEGACY_KEYS as readonly string[]).includes(d.key)) || !data.dimensions.some((d) => d.key === "projects");

/**
 * Upgrades a rubric of the previous format to the standard one: new weights, the new factors, and everything the recruiter had set
 * (must-have skills, years, titles, location, budget, notice, education, custom criteria) carried over.
 */
export function upgradeRubric(old: RubricData, job: JobDetails & { rawText?: string | null }): RubricData {
  const fresh = defaultRubric(job);
  const was = new Map((Array.isArray(old.dimensions) ? old.dimensions : []).map((d) => [d.key as string, d]));
  const dimensions = fresh.dimensions.map((d) => {
    const prev = was.get(d.key);
    const career = was.get("career");
    const config = { ...d.config };
    if (prev?.config) Object.assign(config, prev.config);
    if (d.key === "experience" && career?.config.targetTitles?.length) config.targetTitles = career.config.targetTitles;
    if (d.key === "domain" && career?.config.industries?.length) config.industries = career.config.industries;
    return { ...d, config };
  });
  return { dimensions, custom: Array.isArray(old.custom) ? old.custom : [] };
}

/** Validates and cleans a rubric coming from the browser. Unknown keys are dropped; weights are clamped. */
export function sanitizeRubric(input: unknown, fallback: RubricData): RubricData {
  const raw = (input ?? {}) as Partial<RubricData>;
  const byKey = new Map((Array.isArray(raw.dimensions) ? raw.dimensions : []).map((d) => [d?.key, d]));
  const num = (value: unknown, fb: number) => (typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fb);
  const list = (value: unknown, fb: string[] = []) => (Array.isArray(value) ? value.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 40) : fb);
  const optNum = (value: unknown, fb: number | null | undefined) => (value === null ? null : typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : (fb ?? null));
  const dimensions = fallback.dimensions.map((base) => {
    const d = byKey.get(base.key);
    if (!d) return base;
    const c = (d.config ?? {}) as RubricDimension["config"];
    const config: RubricDimension["config"] = { ...base.config };
    if ("mustHave" in c) config.mustHave = list(c.mustHave, base.config.mustHave);
    if ("nice" in c) config.nice = list(c.nice, base.config.nice);
    if ("minYears" in c) config.minYears = optNum(c.minYears, base.config.minYears);
    if ("maxYears" in c) config.maxYears = optNum(c.maxYears, base.config.maxYears);
    if ("minLpa" in c) config.minLpa = optNum(c.minLpa, base.config.minLpa);
    if ("maxLpa" in c) config.maxLpa = optNum(c.maxLpa, base.config.maxLpa);
    if ("maxNoticeDays" in c) config.maxNoticeDays = optNum(c.maxNoticeDays, base.config.maxNoticeDays);
    if ("locations" in c) config.locations = list(c.locations, base.config.locations);
    if ("remote" in c) config.remote = Boolean(c.remote);
    if ("required" in c) config.required = list(c.required, base.config.required);
    if ("targetTitles" in c) config.targetTitles = list(c.targetTitles, base.config.targetTitles);
    if ("industries" in c) config.industries = list(c.industries, base.config.industries);
    if ("tools" in c) config.tools = list(c.tools, base.config.tools);
    if ("keywords" in c) config.keywords = list(c.keywords, base.config.keywords);
    return { ...base, weight: num(d.weight, base.weight), enabled: d.enabled !== false, config };
  });
  const custom = (Array.isArray(raw.custom) ? raw.custom : [])
    .map((item) => ({ name: String(item?.name ?? "").trim().slice(0, 60), weight: num(item?.weight, 5), description: String(item?.description ?? "").slice(0, 300), keywords: list(item?.keywords) }))
    .filter((item) => item.name && item.keywords.length > 0)
    .slice(0, 10);
  return { dimensions, custom };
}
