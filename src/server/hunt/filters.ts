import { z } from "zod";

/**
 * Naukri search configuration of a job. These are SEARCH filters only (who to look for on Resdex); they are kept apart from the
 * evaluation rubric (how candidates are judged). The extension reports, per field, what it could really apply and verify.
 *
 * Fields the extension's Resdex form mapping can fill and read back today:  boolean, keywords, anyKeywords, excludeKeywords,
 * designation, minExp, maxExp, location, minSalary, maxSalary, notice, education.
 * The rest are accepted and stored, but the extension answers "unsupported" for them until Resdex's form for them is mapped.
 */
export const SUPPORTED_FILTERS = ["boolean", "keywords", "anyKeywords", "excludeKeywords", "designation", "minExp", "maxExp", "location", "minSalary", "maxSalary", "notice", "education"] as const;
export const UNMAPPED_FILTERS = ["previousDesignation", "preferredLocation", "currentCompany", "industry", "expectedMinSalary", "expectedMaxSalary", "university"] as const;
export type FilterKey = (typeof SUPPORTED_FILTERS)[number] | (typeof UNMAPPED_FILTERS)[number];

const list = z.array(z.string().trim().min(1).max(120)).max(30).default([]);
const num = z.number().min(0).max(1000).nullable().default(null);

export const filtersSchema = z.object({
  boolean: z.string().trim().max(1500).default(""),
  useBoolean: z.boolean().default(true),
  keywords: list,
  anyKeywords: list,
  excludeKeywords: list,
  designation: list,
  previousDesignation: list,
  minExp: num,
  maxExp: num,
  location: list,
  preferredLocation: list,
  currentCompany: list,
  industry: list,
  minSalary: num,
  maxSalary: num,
  expectedMinSalary: num,
  expectedMaxSalary: num,
  notice: z.number().int().min(0).max(180).nullable().default(null),
  education: z.string().trim().max(120).default(""),
  university: list,
});
export type SearchFilters = z.infer<typeof filtersSchema>;

export const limitsSchema = z.object({
  /** Result pages to read in one run. */
  maxPages: z.number().int().min(1).max(50).default(5),
  maxCandidates: z.number().int().min(1).max(1000).default(100),
  /** Pause between pages, so the recruiter's session behaves like a person browsing. */
  delaySeconds: z.number().int().min(3).max(60).default(6),
});
export type TaskLimits = z.infer<typeof limitsSchema>;

/** Default filters from a Resdex search plan (what the platform already knows about the job). */
export function filtersFromPlan(plan: { booleanQuery: string; allKeywords: string[]; anyKeywords: string[]; excludeKeywords: string[]; designations: string[]; minExp: number | null; maxExp: number | null; locations: string[]; maxSalary: number | null; maxNoticeDays: number | null; education: string }): SearchFilters {
  return filtersSchema.parse({
    boolean: plan.booleanQuery,
    keywords: plan.allKeywords,
    anyKeywords: plan.anyKeywords,
    excludeKeywords: plan.excludeKeywords,
    designation: plan.designations.slice(0, 3),
    minExp: plan.minExp,
    maxExp: plan.maxExp,
    location: plan.locations,
    maxSalary: plan.maxSalary,
    notice: plan.maxNoticeDays,
    education: plan.education,
  });
}

/** The payload the extension's existing fill routine understands (SearchFill), taken from the supported filters only. */
export function toSearchFill(f: SearchFilters) {
  return {
    booleanQuery: f.boolean,
    useBoolean: f.useBoolean,
    allKeywords: f.keywords,
    anyKeywords: f.anyKeywords,
    excludeKeywords: f.excludeKeywords,
    designations: f.designation,
    minExp: f.minExp,
    maxExp: f.maxExp,
    locations: f.location,
    minSalary: f.minSalary,
    maxSalary: f.maxSalary,
    maxNoticeDays: f.notice,
    education: f.education,
  };
}

/** Which configured filters have a value (so the UI and the report only mention filters the recruiter actually set). */
export function configuredFilters(f: SearchFilters): FilterKey[] {
  const keys: FilterKey[] = [];
  const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : v !== null && v !== undefined);
  for (const key of [...SUPPORTED_FILTERS, ...UNMAPPED_FILTERS]) if (has((f as Record<string, unknown>)[key])) keys.push(key);
  return keys;
}
