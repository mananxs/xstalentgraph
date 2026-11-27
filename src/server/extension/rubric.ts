import { createHash } from "node:crypto";
import type { JobDetails } from "@/server/repositories/jobRepository";
import type { JobSummary, ResdexPlan, Rubric } from "./types";

const term = (value: string) => (/\s/.test(value.trim()) ? `"${value.trim()}"` : value.trim());
const unique = (items: string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

/** Fingerprint of everything that changes a score. When a job is edited, cached scores under the old hash stop matching. */
export function rubricHash(job: JobDetails, rubricVersion = 0): string {
  const description = createHash("sha1").update(job.description ?? "").digest("hex");
  const basis = {
    t: job.title,
    r: job.requiredSkills,
    p: job.preferredSkills,
    l: job.languages,
    loc: job.locations,
    y: job.experienceYears,
    s: job.seniority,
    d: description,
    v: rubricVersion,
  };
  return createHash("sha1").update(JSON.stringify(basis)).digest("hex").slice(0, 16);
}

export function resdexPlan(job: JobDetails): ResdexPlan {
  const required = unique([...job.requiredSkills, ...job.languages]);
  const all = required.slice(0, 3);
  const any = unique([...required.slice(3), ...job.preferredSkills]).slice(0, 6);
  const years = job.experienceYears && job.experienceYears > 0 ? Math.round(job.experienceYears) : null;
  let query = all.map(term).join(" AND ");
  if (any.length > 0) query += `${query ? " AND " : ""}(${any.map(term).join(" OR ")})`;
  return {
    booleanQuery: query || term(job.title),
    allKeywords: all,
    anyKeywords: any,
    excludeKeywords: [],
    designations: [job.title],
    minExp: years,
    maxExp: years === null ? null : years + 4,
    minSalary: null,
    maxSalary: null,
    maxNoticeDays: null,
    locations: job.locations.slice(0, 5),
    education: "",
  };
}

export function rubricOf(job: JobDetails): Rubric {
  const plan = resdexPlan(job);
  const must = unique([...job.requiredSkills, ...job.languages]);
  const years = job.experienceYears && job.experienceYears > 0 ? job.experienceYears : 0;
  return {
    title: job.title,
    seniority: job.seniority ?? "",
    mustHaveSkills: must,
    importantSkills: [],
    niceToHaveSkills: job.preferredSkills,
    dealBreakers: [],
    targetTitles: [job.title],
    minExperienceYears: years,
    maxExperienceYears: years ? years + 4 : 0,
    maxNoticePeriodDays: 60,
    ctcBudgetMinLpa: 0,
    ctcBudgetMaxLpa: 0,
    locations: job.locations,
    remotePolicy: job.workMode ?? (job.remoteAllowed ? "remote" : ""),
    domainContext: "",
    coreKeywords: must.slice(0, 6),
    booleanQuery: plan.booleanQuery,
    mustHaveKeywords: plan.allKeywords,
    excludeKeywords: [],
    minExp: plan.minExp ?? -1,
    maxExp: plan.maxExp ?? -1,
  };
}

export function jobSummary(job: JobDetails, candidateCount: number, rubricVersion = 0): JobSummary {
  return {
    id: job.id,
    title: job.title,
    department: null,
    location: job.locations[0] ?? null,
    candidateCount,
    rubric: rubricOf(job),
    rubricHash: rubricHash(job, rubricVersion),
    search: resdexPlan(job),
  };
}
