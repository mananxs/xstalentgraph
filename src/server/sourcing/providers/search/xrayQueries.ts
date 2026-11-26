import type { DiscoveryJobInput } from "./types";

/**
 * Google X-Ray "micro-queries" for LinkedIn profiles in the Indian market.
 *
 * Why micro-queries: Google shows at most ~100 results for any one query. One broad query ("React developer India")
 * therefore reaches 100 people out of tens of thousands. Slicing the SAME search into many narrow ones, one per
 * (city x job title x skill) cell, gives every slice its own 100-result window, so dozens of queries reach thousands
 * of distinct profiles. Duplicates across slices are removed by the caller.
 *
 * Format of one query:
 *   site:linkedin.com/in "React" "Senior React Developer" ("Bengaluru" OR "Bangalore") -intitle:"profiles" -inurl:"dir"
 *
 * `-intitle:"profiles"` and `-inurl:"dir"` drop LinkedIn's directory / "N professionals named X" listing pages,
 * which are not people.
 */

/** City -> every spelling people use on LinkedIn for it (Delhi NCR is really four places). */
export const INDIAN_TECH_HUBS: ReadonlyArray<{ city: string; aliases: string[] }> = [
  { city: "Bangalore", aliases: ["Bengaluru", "Bangalore"] },
  { city: "Pune", aliases: ["Pune"] },
  { city: "Delhi NCR", aliases: ["Delhi", "Gurugram", "Gurgaon", "Noida"] },
  { city: "Mumbai", aliases: ["Mumbai", "Navi Mumbai"] },
  { city: "Hyderabad", aliases: ["Hyderabad"] },
  { city: "Chennai", aliases: ["Chennai"] },
  { city: "Jaipur", aliases: ["Jaipur"] },
];

const SENIORITY_WORDS = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|head of|manager|intern|graduate|entry[- ]level)\b/gi;
const MAX_TITLE_VARIANTS = 4;
const MAX_SKILLS_PER_QUERY_SET = 4;
export const DEFAULT_MAX_MICRO_QUERIES = 60;
/** Google ignores very long queries; stay well under the limit. */
const MAX_QUERY_LENGTH = 400;

const SITE = "site:linkedin.com/in";
const EXCLUSIONS = '-intitle:"profiles" -inurl:"dir"';

const clean = (value: string): string => value.replace(/["':()]/g, " ").replace(/\s+/g, " ").trim();
const quote = (value: string): string => `"${value}"`;
const anyOf = (values: string[]): string => (values.length === 1 ? quote(values[0]!) : `(${values.map(quote).join(" OR ")})`);

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "Senior React Developer (Remote)" -> "React Developer". */
export function coreTitle(title: string): string {
  return clean(title.replace(/\(.*?\)/g, " ").replace(SENIORITY_WORDS, " ")).slice(0, 60);
}

/** Seniority label: the job's own field first, else a word found in the title. */
export function seniorityOf(job: Pick<DiscoveryJobInput, "seniority" | "title">): string | null {
  const own = job.seniority ? clean(job.seniority) : "";
  if (own) return own;
  const match = /\b(senior|junior|lead|principal|staff)\b/i.exec(job.title);
  return match?.[1] ? match[1][0]!.toUpperCase() + match[1].slice(1).toLowerCase() : null;
}

/** Wording variants people really use for the same role ("Full Stack" / "Fullstack", "Developer" / "Engineer"). */
export function titleVariants(title: string): string[] {
  const base = coreTitle(title);
  if (!base) return [];
  const variants = [base];

  const swap = (from: RegExp, to: string[]): void => {
    for (const current of [...variants]) {
      if (from.test(current)) for (const replacement of to) variants.push(current.replace(from, replacement));
    }
  };
  swap(/\bfull[\s-]?stack\b/i, ["Fullstack"]);
  swap(/\bfront[\s-]?end\b/i, ["Frontend"]);
  swap(/\bback[\s-]?end\b/i, ["Backend"]);
  swap(/\bdeveloper\b/i, ["Engineer"]);
  swap(/\bengineer\b/i, ["Developer"]);
  swap(/\bprogrammer\b/i, ["Developer"]);
  return dedupe(variants);
}

/** Must-have skills first, then languages, then nice-to-haves. */
function skillsOf(job: DiscoveryJobInput): string[] {
  return dedupe([...job.requiredSkills, ...job.languages, ...job.preferredSkills].map(clean).filter(Boolean));
}

/**
 * The hubs to slice over: the job's own Indian cities first (they matter most), then the standard hubs.
 * A job city that is not a known hub (e.g. "Kochi") becomes its own slice.
 */
function citySlices(job: DiscoveryJobInput): Array<{ city: string; aliases: string[] }> {
  const slices: Array<{ city: string; aliases: string[] }> = [];
  const used = new Set<string>();
  const add = (slice: { city: string; aliases: string[] }): void => {
    if (!used.has(slice.city.toLowerCase())) {
      used.add(slice.city.toLowerCase());
      slices.push(slice);
    }
  };

  const hubOf = (name: string) =>
    INDIAN_TECH_HUBS.find((hub) => [hub.city, ...hub.aliases].some((alias) => alias.toLowerCase() === name.toLowerCase()));

  for (const location of job.locations) {
    const first = clean(location.split(/[,/]/)[0] ?? "");
    if (!first || /remote|hybrid|on-?site|anywhere|worldwide|flexible|india/i.test(first)) continue;
    const hub = hubOf(first);
    add(hub ?? { city: first, aliases: [first] });
  }
  for (const hub of INDIAN_TECH_HUBS) add(hub);
  return slices;
}

export interface MicroQueryOptions {
  /** Hard cap on how many queries are returned (each one costs an Apify search). Default 60. */
  maxQueries?: number;
}

/**
 * Generates up to `maxQueries` distinct micro-queries: city x title variant x skill.
 *
 * The list is ordered ROUND-ROBIN so that cutting it short never leaves a city out: first the strongest slice of
 * every city (best title x best skill), then the next-strongest slice of every city, and so on. The caller can
 * therefore stop after any query (enough candidates found) and still have covered every hub evenly.
 *
 * Throws when the job has neither a title nor a skill to search on.
 */
export function buildMicroQueries(job: DiscoveryJobInput, options: MicroQueryOptions = {}): string[] {
  const maxQueries = Math.max(1, options.maxQueries ?? DEFAULT_MAX_MICRO_QUERIES);
  const titles = titleVariants(job.title).slice(0, MAX_TITLE_VARIANTS);
  const skills = skillsOf(job).slice(0, MAX_SKILLS_PER_QUERY_SET);
  const seniority = seniorityOf(job);

  if (titles.length === 0 && skills.length === 0) {
    throw new Error("The job needs a title or at least one skill to search LinkedIn.");
  }

  // Seniority is attached to the lead title only: "Senior React Developer" is how the strict slice reads, while the
  // plain variants keep catching people who left "Senior" out of their headline.
  const titleTerms: Array<string | null> =
    titles.length === 0 ? [null] : titles.map((title, index) => (index === 0 && seniority ? `${seniority} ${title}` : title));
  const skillTerms: Array<string | null> = skills.length === 0 ? [null] : skills;
  const cities = citySlices(job);

  // "rank" = how strong the (title, skill) pair is: lower is better. Title index dominates, skill index breaks ties.
  const cells: Array<{ rank: number; title: string | null; skill: string | null }> = [];
  skillTerms.forEach((skill, skillIndex) => {
    titleTerms.forEach((title, titleIndex) => cells.push({ rank: titleIndex * 2 + skillIndex, title, skill }));
  });
  cells.sort((a, b) => a.rank - b.rank);

  const queries: string[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    for (const city of cities) {
      const query = [
        SITE,
        cell.skill ? quote(cell.skill) : "",
        cell.title ? quote(cell.title) : "",
        anyOf(city.aliases),
        EXCLUSIONS,
      ]
        .filter(Boolean)
        .join(" ");

      if (query.length > MAX_QUERY_LENGTH || seen.has(query.toLowerCase())) continue;
      seen.add(query.toLowerCase());
      queries.push(query);
      if (queries.length >= maxQueries) return queries;
    }
  }
  return queries;
}
