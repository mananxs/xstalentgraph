/** The job fields discovery needs. */
export interface DiscoveryJobInput {
  title: string;
  requiredSkills: string[];
  preferredSkills: string[];
  languages: string[];
  locations: string[];
  remoteAllowed: boolean;
  seniority: string | null;
}

/** One LinkedIn profile as Google shows it in the results page. This is ALL the data a SERP gives us. */
export interface SerpCandidate {
  /** Public identifier (the slug in /in/<slug>), lower case. The candidate's stable key. */
  linkedinId: string;
  /** Canonical https://www.linkedin.com/in/<id> URL. */
  linkedinUrl: string;
  /** Person's name parsed from the result title ("Jane Doe - Senior Engineer - Acme | LinkedIn"). null if unreadable. */
  name: string | null;
  /** Headline parsed from the result title ("Senior Engineer - Acme"). null if the title has only a name. */
  headline: string | null;
  /** Location when Google's snippet carries one ("Location: Pune"). */
  location: string | null;
  /** The raw result title, untouched. */
  rawTitle: string;
  /** The raw text snippet Google shows under the result, untouched. Phone numbers are scanned from this. */
  snippet: string;
  /** The X-Ray query that found this profile. */
  query: string;
}

export interface DiscoveryResult {
  /** De-duplicated candidates, best-ranked first (earlier queries / higher results first). */
  candidates: SerpCandidate[];
  /** Every query that was sent. */
  queriesTried: string[];
  /** How many NEW candidates each query contributed, aligned with `queriesTried`. */
  resultsPerQuery: number[];
}

/** A search provider turns a job into candidate profiles. Swap the implementation without touching the pipeline. */
export interface SearchProvider {
  /**
   * `onNewCandidates` is called after every search run with the candidates that are new in this discovery (plus
   * any earlier candidate whose snippet grew), so the pipeline can save and score them while the next run searches.
   * Saving must be idempotent.
   */
  discover(
    job: DiscoveryJobInput,
    maxCandidates: number,
    onNewCandidates?: (candidates: SerpCandidate[]) => Promise<void>,
  ): Promise<DiscoveryResult>;
}
