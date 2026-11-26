import { aliasesOf } from "@/server/ai/heuristic";
import type { DiscoveryJobInput } from "@/server/sourcing/providers/search/types";
import { coreTitle, seniorityOf } from "@/server/sourcing/providers/search/xrayQueries";
import type { CutshortSearchParams } from "./client";

/**
 * Turns a job into one Cutshort search. Per the Cutshort docs:
 *  - `q` ranks semantically (short phrases such as "python developer" work);
 *  - skills go in `inresume`, a Lucene boolean over the whole resume: 2-4 groups, synonyms joined with OR,
 *    phrases quoted, uppercase AND / OR;
 *  - experience needs BOTH bounds;
 *  - locations: spaces become "+", several cities are dash-separated, Bangalore is "Bengaluru+%28Bangalore%29".
 */

const MAX_SKILL_GROUPS = 3;
const MAX_ALIASES_PER_GROUP = 5;

const quoteIfNeeded = (term: string): string => (/^[a-z0-9]+$/i.test(term) ? term : `"${term.replace(/"/g, "")}"`);

/** "React" -> (react OR reactjs OR "react.js"). Short ambiguous aliases are dropped by aliasesOf. */
export function skillGroup(skill: string): string {
  const terms = [...new Set(aliasesOf(skill).map((alias) => alias.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_ALIASES_PER_GROUP);
  return terms.length === 1 ? quoteIfNeeded(terms[0]!) : `(${terms.map(quoteIfNeeded).join(" OR ")})`;
}

/** Cutshort's spelling of a city. Only Bangalore is documented as special; other cities just swap spaces for "+". */
export function cutshortCity(city: string): string {
  const name = city.trim();
  if (/^(bengaluru|bangalore|bengaluru \(bangalore\))$/i.test(name)) return "Bengaluru+%28Bangalore%29";
  return name.replace(/\s+/g, "+");
}

/** Years bounds from the job. Both bounds or none, as Cutshort requires. */
function experienceBand(job: DiscoveryJobInput & { experienceYears?: number | null }): { minexp: number; maxexp: number } | null {
  const years = typeof job.experienceYears === "number" && job.experienceYears > 0 ? job.experienceYears : null;
  if (years !== null) return { minexp: Math.max(0, Math.floor(years - 1)), maxexp: Math.ceil(years + 6) };
  const level = (seniorityOf(job) ?? "").toLowerCase();
  if (/junior|graduate|intern/.test(level)) return { minexp: 0, maxexp: 3 };
  if (/senior/.test(level)) return { minexp: 4, maxexp: 12 };
  if (/lead|principal|staff|head/.test(level)) return { minexp: 7, maxexp: 20 };
  return null;
}

export function buildCutshortSearch(job: DiscoveryJobInput & { experienceYears?: number | null }): CutshortSearchParams {
  const skills = [...new Set([...job.requiredSkills, ...job.languages, ...job.preferredSkills].map((s) => s.trim()).filter(Boolean))];
  const title = coreTitle(job.title);
  if (!title && skills.length === 0) throw new Error("The job needs a title or at least one skill to search Cutshort.");

  const params: CutshortSearchParams = {};
  params.q = [title, ...skills.slice(0, 4)].filter(Boolean).join(" ").slice(0, 300);

  // Required skills are the groups (preferred ones only fill the gaps): more than 4 groups would cut recall.
  const groupSkills = [...new Set([...job.requiredSkills, ...job.languages].map((s) => s.trim()).filter(Boolean))].slice(0, MAX_SKILL_GROUPS);
  if (groupSkills.length > 0) params.inresume = groupSkills.map(skillGroup).join(" AND ");

  const band = experienceBand(job);
  if (band) Object.assign(params, band);

  const cities = job.locations
    .map((location) => (location.split(/[,/]/)[0] ?? "").trim())
    .filter((city) => city && !/remote|hybrid|on-?site|anywhere|worldwide|flexible|india/i.test(city));
  if (cities.length > 0) params.locations = [...new Set(cities.map(cutshortCity))].join("-");

  return params;
}
