/** The only job fields the GitHub search needs. */
export interface JobSearchInput {
  languages: string[];
  locations: string[];
}

export interface SearchQueryOptions {
  /** Skip near-empty accounts. Default 3. */
  minRepos?: number;
  /** Safety cap on how many searches one job may start. Default 12. */
  maxQueries?: number;
}

const DEFAULT_MIN_REPOS = 3;
const DEFAULT_MAX_QUERIES = 12;

/** Trims, removes characters that would break a search qualifier, and dedupes (case-insensitive). */
function cleanList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = value.replace(/["':]/g, " ").replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();
    if (cleaned && !seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }
  return result;
}

/** Wraps a value in quotes only when it contains a space (e.g. "Jupyter Notebook"). */
function qualifier(name: string, value: string): string {
  return value.includes(" ") ? `${name}:"${value}"` : `${name}:${value}`;
}

/**
 * Turns a job's requirements into GitHub user-search strings.
 *
 * What GitHub user search can and cannot do:
 *  - It can filter by location, language, repos and followers. It CANNOT search bios or topics.
 *  - Repeating a location qualifier ANDs the locations, so we run ONE search PER location.
 *  - Frameworks and skills (FastAPI, SQLAlchemy...) are judged later by Gemini, not here.
 *  - A single search returns at most 1000 users.
 *
 * We do not sort by followers: popularity must not decide who gets seen.
 * Locations come first in the loop, so if the safety cap cuts queries, every location is still covered.
 *
 * @throws If the job has neither a language nor a location (the search would be meaningless).
 */
export function buildSearchQueries(job: JobSearchInput, options: SearchQueryOptions = {}): string[] {
  const minRepos = options.minRepos ?? DEFAULT_MIN_REPOS;
  const maxQueries = options.maxQueries ?? DEFAULT_MAX_QUERIES;

  const languages = cleanList(job.languages);
  const locations = cleanList(job.locations);

  if (languages.length === 0 && locations.length === 0) {
    throw new Error("The job needs at least one programming language or one location to search GitHub.");
  }

  // null means "no filter of this kind".
  const locationChoices: Array<string | null> = locations.length > 0 ? locations : [null];
  const languageChoices: Array<string | null> = languages.length > 0 ? languages : [null];

  const queries: string[] = [];
  for (const location of locationChoices) {
    for (const language of languageChoices) {
      const parts: string[] = [];
      if (location) parts.push(qualifier("location", location));
      if (language) parts.push(qualifier("language", language));
      parts.push(`repos:>=${minRepos}`);
      queries.push(parts.join(" "));
    }
  }

  return queries.slice(0, maxQueries);
}
