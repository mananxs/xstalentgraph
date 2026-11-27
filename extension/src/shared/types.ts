export interface Config {
  baseUrl: string; // e.g. http://localhost:3000 (no trailing slash)
  apiKey: string; // THIS HR's per-user extension key (all server data is scoped to it)
  user?: { id: string; email: string; name: string | null }; // who is logged in (set by email+password login / validated key)
}

/** Panel-level preferences (local storage). */
export interface Settings {
  /** "Analyzed only": show/ban re-scoring — cards already analyzed under this job's rubric come from the cache, new cards are NOT sent to the AI. */
  analyzedOnly: boolean;
  /** Pull the Naukri search bar / filters into the Boolean-query draft as they change. */
  autoSync: boolean;
  /** Start/Stop: while false (the default after every browser start / login) NOTHING is sent to the AI; only already-analyzed cards are shown. */
  scoring: boolean;
  /** Send the candidate cards you are looking at in Resdex to the active job in XS-Hunt automatically (no AI is spent by this). */
  autoSend: boolean;
}
export const DEFAULT_SETTINGS: Settings = { analyzedOnly: false, autoSync: true, scoring: false, autoSend: true };


/** Everything the recruiter can set on the Resdex search page. Mirrors the server's SearchStateZ. */
export interface SearchState {
  keywords: string; // the "all keywords" / main box
  anyKeywords: string[];
  excludeKeywords: string[];
  location: string;
  minExp: number | null;
  maxExp: number | null;
  minSalary: number | null;
  maxSalary: number | null;
  filters: { label: string; value: string }[];
  url: string;
  page: number | null;
}
/** What the content script publishes: the form AS IT IS NOW (live) and the search that produced the cards on screen (applied). */
export interface SearchSnapshot {
  live: SearchState;
  liveSig: string;
  applied: SearchState;
  appliedSig: string;
  ts: number;
}
export interface SearchSessionInfo {
  id: string;
  sig: string;
  jobId: string;
  label: string;
  analyzedCount: number;
}

export interface AnalyzedItem {
  key: string;
  kind: "card" | "deep";
  score: number;
  displayName: string | null;
  profileUrl: string | null;
  updatedAt: string;
  result: Partial<CardResult> & { verdict?: string; extracted?: Partial<CardExtracted> & { totalExpYears?: number }; matchedSkills?: string[]; missingSkills?: string[]; strengths?: string[]; tier?: string };
}
export interface AnalyzedList {
  items: AnalyzedItem[];
  /** Rows scored under an OLDER version of the rubric (not listed — they would be misleading). */
  staleCount: number;
  /** What was actually listed: the current search, or the whole job (no search known yet). */
  scope?: "search" | "job";
  session?: SearchSessionInfo | null;
}

export type Strictness = "lenient" | "balanced" | "strict";
export interface ScoreWeights {
  must: number;
  important: number;
  nice: number;
  title: number;
  experience: number;
  notice: number;
  ctc: number;
  location: number;
}
export const DEFAULT_WEIGHTS: ScoreWeights = { must: 3, important: 2, nice: 1, title: 2, experience: 3, notice: 1.5, ctc: 1.5, location: 1.5 };

export interface Rubric {
  title: string;
  seniority: string;
  mustHaveSkills: string[];
  importantSkills?: string[];
  niceToHaveSkills: string[];
  dealBreakers?: string[];
  targetTitles?: string[];
  strictness?: Strictness;
  customInstructions?: string;
  weights?: Partial<ScoreWeights>;
  minExperienceYears: number;
  maxExperienceYears: number;
  maxNoticePeriodDays: number;
  ctcBudgetMinLpa: number;
  ctcBudgetMaxLpa: number;
  locations: string[];
  remotePolicy: string;
  domainContext: string;
  coreKeywords: string[];
  // Resdex search parameters — absent on jobs saved before this version (the panel then falls back to the legacy fields).
  booleanQuery?: string;
  mustHaveKeywords?: string[];
  excludeKeywords?: string[];
  minExp?: number; // -1 = not stated
  maxExp?: number;
}

/** Everything typed into Resdex for a job. Computed by the SERVER (lib/resdexQuery.ts → resdexSearchPlan) so web and extension agree. */
export interface ResdexPlan {
  booleanQuery: string;
  allKeywords: string[];
  anyKeywords: string[];
  excludeKeywords: string[];
  designations: string[];
  minExp: number | null;
  maxExp: number | null;
  minSalary: number | null;
  maxSalary: number | null;
  maxNoticeDays: number | null;
  locations: string[];
  education: string;
}

export interface JobSummary {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  candidateCount: number;
  rubric: Rubric | null;
  rubricHash?: string | null;
  search?: ResdexPlan | null;
}

/** Editable parts of a job's scoring/search, PATCHed to /api/extension/jobs/:id. Mirrors the server's RubricEditsZ. */
export interface RubricEdits {
  mustHaveSkills?: string[];
  importantSkills?: string[];
  niceToHaveSkills?: string[];
  dealBreakers?: string[];
  targetTitles?: string[];
  locations?: string[];
  excludeKeywords?: string[];
  mustHaveKeywords?: string[];
  minExperienceYears?: number;
  maxExperienceYears?: number;
  maxNoticePeriodDays?: number;
  ctcBudgetMaxLpa?: number;
  strictness?: Strictness;
  customInstructions?: string;
  weights?: Partial<ScoreWeights>;
  booleanQuery?: string;
}

export interface ActiveJob {
  id: string;
  title: string;
  coreKeywords: string[];
  mustHaveSkills: string[];
  /** Hash of the rubric the scores were computed with — changes when the job is edited on the dashboard. */
  sig?: string;
  /** Resdex search fields. Optional so an activeJob stored by an older build still loads. */
  booleanQuery?: string;
  minExp?: number | null;
  maxExp?: number | null;
  locations?: string[];
  /** The server's full Resdex plan (all keyword boxes, designation, salary, notice, education). */
  search?: ResdexPlan | null;
}

/** What gets typed into the Resdex search form. Values only — the recruiter presses Search. */
export interface SearchFill {
  booleanQuery: string;
  minExp: number | null;
  maxExp: number | null;
  locations: string[];
  // Optional extras (older panels send only the four above)
  allKeywords?: string[];
  anyKeywords?: string[];
  excludeKeywords?: string[];
  designations?: string[];
  minSalary?: number | null;
  maxSalary?: number | null;
  maxNoticeDays?: number | null;
  education?: string;
  /** Switch Resdex into Boolean mode first when it has such a toggle (default true). */
  useBoolean?: boolean;
}
export type FillKey = "boolean" | "keywords" | "anyKeywords" | "excludeKeywords" | "designation" | "minExp" | "maxExp" | "location" | "minSalary" | "maxSalary" | "notice" | "education";
export interface FillField {
  key: FillKey;
  label: string;
  /** filled = typed/selected by us · manual = the field exists but needs the recruiter (chip picker, suggestion list) · missing = not found on this page */
  status: "filled" | "manual" | "missing";
  detail?: string;
}
export interface FillReport {
  ok: boolean;
  error?: string;
  filled: Record<FillKey, boolean>;
  fields: FillField[];
  notes: string[];
}

/** What the content script reads from an OPEN profile at the moment the recruiter acts (save / attach CV). */
export interface ProfileSnapshot {
  open: boolean;
  url: string;
  rawText: string;
  phones: string[];
  emails: string[];
  /** A number is shown but masked → the contact details are not unlocked on Resdex yet. */
  phoneMasked: boolean;
  cvLinks: { href: string; label: string }[];
}

/** "Worth 1 CV View" recommendation. open = High Priority · review = Borderline · skip = Save Quota. */
export type Worth = "open" | "review" | "skip";

export interface CardExtracted {
  fullName: string;
  currentRole: string;
  currentCompany: string;
  headline: string;
  skills: string[];
  expYears: number; // -1 unknown
  currentCtcLpa: number;
  expectedCtcLpa: number;
  location: string;
}

export interface CardResult {
  domId: string;
  /** ai = judged by the model against the JD and rubric; rules = the offline rule engine (no AI was available). */
  scoredBy?: "ai" | "rules";
  /** Server-side candidate identity (profile URL or text fingerprint) — stable across re-renders and sessions. */
  key?: string;
  /** true = served from the score cache (no AI call was made for this card). */
  cached?: boolean;
  confidence?: "high" | "medium" | "low";
  score: number;
  tier: string;
  matchedSkills: string[];
  missingSkills: string[];
  noticePeriod: string;
  noticeDays: number; // -1 unknown
  ctc: string;
  oneLineVerdict: string;
  // Added by the quota-first scorer; optional so results from an older server still render.
  worth?: Worth;
  worthReasons?: string[];
  extracted?: CardExtracted;
}

/** Score-only fallback when the server did not send a `worth` verdict. */
export function worthOf(r: CardResult): Worth {
  return r.worth ?? (r.score >= 80 ? "open" : r.score >= 60 ? "review" : "skip");
}

export const WORTH_LABEL: Record<Worth, { short: string; long: string }> = {
  open: { short: "Worth 1 CV View", long: "High Priority · Open Profile" },
  review: { short: "Review card", long: "Borderline · Review Card First" },
  skip: { short: "Skip", long: "Skip · Save Quota" },
};

/** unscored = "Analyzed only" mode: not in the cache yet, deliberately NOT sent to the AI. */
export type RankState = "pending" | "done" | "error" | "blocked" | "unscored";

export interface RankEntry {
  domId: string;
  label: string;
  rawText: string;
  state: RankState;
  result?: CardResult;
  error?: string;
  /** Profile link read from the card's own anchor (never clicked/opened by us). */
  profileUrl?: string;
}

/** One card → "Save Card to Shortlist". Mirrors the server's CardImportZ. */
export interface CardSavePayload {
  key: string; // hashStr(jobId|rawText): stable across SPA re-renders
  domId: string;
  label: string; // fallback display name if the model couldn't read one
  rawText: string; // ≤ 2,500 chars of visible card text
  profileUrl?: string;
  result: CardResult;
}
export interface SaveState {
  status: "saving" | "saved" | "error";
  duplicate?: boolean;
  keptFullProfile?: boolean;
  error?: string;
}
export type SaveMap = Record<string, SaveState>;

export interface Audit {
  extracted: {
    fullName: string;
    currentRole: string;
    currentCompany: string;
    totalExpYears: number;
    currentCtcLpa: number;
    expectedCtcLpa: number;
    noticePeriod: string;
    noticeDays: number;
    location: string;
    email: string;
    phone: string;
  };
  score: number;
  tier: string;
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  risks: string[];
  noticeFit: "good" | "ok" | "risk" | "unknown";
  noticeNote: string;
  ctcFit: "good" | "ok" | "risk" | "unknown";
  ctcNote: string;
  experienceNote: string;
  interviewQuestions: string[];
  verdict: string;
}

export interface DetailState {
  key: string; // hash of url+text+jobId — avoids duplicate audits
  status: "loading" | "ready" | "error";
  label: string;
  url: string;
  rawText: string;
  jobId: string;
  audit?: Audit;
  error?: string;
  save?: {
    status: "saving" | "saved" | "error";
    duplicate?: boolean;
    webUrl?: string;
    error?: string;
    candidateId?: string;
    /** What was captured when saving. */
    contact?: { phone: string | null; email: string | null; phoneMasked: boolean };
    cv?: { status: "idle" | "fetching" | "saved" | "error" | "none"; fileName?: string; phoneFromCv?: boolean; error?: string };
  };
}

/* ─── XS-Hunt agent (platform-driven sourcing) ─── */

/** The sourcing run this browser is executing for a platform task. Persisted so it survives page reloads and worker restarts. */
export interface AgentRun {
  taskId: string;
  jobId?: string;
  state: AgentRunState;
  limits: { maxPages: number; maxCandidates: number; delaySeconds: number };
  /** Page the pager is on (1-based). */
  page: number;
  pagesDone: number;
  captured: number;
  /** Signature of the last page captured, so a reload mid-run never captures the same page twice as a "new" page. */
  lastSig?: string;
}

export type AgentRunState = "idle" | "running" | "paused" | "stopped" | "completed";
export type FieldStatus = "applied" | "unsupported" | "failed" | "attention";
export interface FieldVerdict {
  status: FieldStatus;
  detail?: string;
}

/* ─── Message protocol ─── */

export type ContentToBg =
  | { type: "SCORE_CARDS"; cards: { domId: string; rawText: string; profileUrl?: string }[]; onlyCached?: boolean }
  | { type: "SEARCH_STATE"; snapshot: SearchSnapshot }
  | { type: "PUBLISH_RANKING"; entries: RankEntry[] }
  | { type: "PROFILE_DETECTED"; url: string; rawText: string; label: string }
  | { type: "CARD_CLICKED"; domId: string }
  | { type: "AGENT_TICK" }
  | { type: "AGENT_CAPTURE"; taskId: string; page: number; cards: unknown[] }
  | { type: "AGENT_EVENT"; taskId: string; kind: string; message: string; data?: Record<string, unknown> }
  | { type: "AGENT_RUN_STATE"; taskId: string; state: AgentRunState; reason?: string };

export type PanelToBg =
  | { type: "CONNECT"; config: Config }
  | { type: "LOGIN"; baseUrl: string; email: string; password: string }
  | { type: "PAIR"; baseUrl: string; code: string }
  | { type: "LOGOUT" }
  | { type: "READ_PROFILE"; tabId: number }
  | { type: "ATTACH_CV"; tabId: number }
  | { type: "MAP_FORM"; tabId: number }
  | { type: "GET_ANALYZED"; tabId: number | null; scope: "search" | "job"; minScore?: number }
  | { type: "SCORE_PENDING"; tabId: number }
  | { type: "READ_SEARCH"; tabId: number }
  | { type: "GET_JOBS" }
  | { type: "CREATE_ADHOC_JOB"; rawDescription: string; title?: string }
  | { type: "ANALYZE_TEXT"; tabId: number; rawText: string; label: string; url: string }
  | { type: "SAVE_CANDIDATE"; tabId: number }
  | { type: "FILL_SEARCH"; tabId: number; fields: SearchFill }
  | { type: "SAVE_CARDS"; tabId: number; cards: CardSavePayload[] }
  | { type: "FOCUS_CARD"; tabId: number; domId: string }
  | { type: "AGENT_TICK" }
  | { type: "ENSURE_CONTENT"; tabId: number };

export type BgToContent =
  | { type: "FILL_RESDEX_SEARCH"; fields: SearchFill }
  | { type: "URL_CHANGED" }
  | { type: "READ_PROFILE" }
  | { type: "FETCH_CV"; href: string }
  | { type: "MAP_FORM" }
  | { type: "READ_SEARCH" }
  | { type: "SCORE_PENDING" }
  | { type: "FOCUS_CARD"; domId: string }
  | { type: "PING" };

export interface Reply<T = unknown> {
  ok: boolean;
  error?: string;
  code?: "NOT_CONFIGURED" | "NO_JOB" | "AUTH";
  data?: T;
}

/* ─── Storage keys ─── */
export const K = {
  config: "config", // local
  activeJob: "activeJob", // local
  settings: "settings", // local — Settings
  search: (tabId: number) => `search:${tabId}`, // session — SearchSnapshot
  searchSession: (tabId: number) => `searchSession:${tabId}`, // session — SearchSessionInfo for the applied search
  rank: (tabId: number) => `rank:${tabId}`, // session
  detail: (tabId: number) => `detail:${tabId}`, // session
  focus: (tabId: number) => `focus:${tabId}`, // session
  saved: (tabId: number) => `saved:${tabId}`, // session — SaveMap of cards saved to the shortlist
  queryDraft: (jobId: string) => `queryDraft:${jobId}`, // local — recruiter's edited Boolean/exp/location
};
