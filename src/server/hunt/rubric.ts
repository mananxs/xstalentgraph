import type { JobDetails } from "@/server/repositories/jobRepository";

/** The seven standard evaluation dimensions. */
export const DIMENSION_KEYS = ["skills", "experience", "compensation", "availability", "location", "education", "career"] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DIMENSION_LABEL: Record<DimensionKey, string> = {
  skills: "Skills",
  experience: "Experience",
  compensation: "Compensation",
  availability: "Availability",
  location: "Location",
  education: "Education",
  career: "Career Background",
};

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

export const DEFAULT_WEIGHTS: Record<DimensionKey, number> = { skills: 30, experience: 20, compensation: 10, availability: 10, location: 10, education: 5, career: 15 };

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

/** The first rubric of a job: the seven standard dimensions filled from what the JD says. */
export function defaultRubric(job: JobDetails & { rawText?: string | null }): RubricData {
  const text = `${job.title}\n${job.description}\n${job.rawText ?? ""}`;
  const c = readJdConstraints(text);
  const years = job.experienceYears && job.experienceYears > 0 ? job.experienceYears : null;
  const must = [...new Set([...job.requiredSkills, ...job.languages])];
  const config: Record<DimensionKey, RubricDimension["config"]> = {
    skills: { mustHave: must, nice: job.preferredSkills },
    experience: { minYears: years, maxYears: years ? years + 5 : null },
    compensation: { minLpa: null, maxLpa: c.maxLpa },
    availability: { maxNoticeDays: c.maxNoticeDays ?? 60 },
    location: { locations: job.locations, remote: job.remoteAllowed },
    education: { required: c.education },
    career: { targetTitles: [job.title], industries: [] },
  };
  return {
    dimensions: DIMENSION_KEYS.map((key) => ({ key, label: DIMENSION_LABEL[key], weight: DEFAULT_WEIGHTS[key], enabled: true, config: config[key] })),
    custom: [],
  };
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
    return { ...base, weight: num(d.weight, base.weight), enabled: d.enabled !== false, config };
  });
  const custom = (Array.isArray(raw.custom) ? raw.custom : [])
    .map((item) => ({ name: String(item?.name ?? "").trim().slice(0, 60), weight: num(item?.weight, 5), description: String(item?.description ?? "").slice(0, 300), keywords: list(item?.keywords) }))
    .filter((item) => item.name && item.keywords.length > 0)
    .slice(0, 10);
  return { dimensions, custom };
}
