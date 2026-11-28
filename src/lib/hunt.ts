/** Client-side types and calls for the XS-Hunt workspace (jobs, candidates, sourcing tasks, pipeline, analytics, team). */
import { request } from "./api";

export type Tier = "strong" | "potential" | "weak" | "provisional" | "needs_info";
export const TIER_LABEL: Record<Tier, string> = { strong: "Strong Match", potential: "Potential Match", weak: "Weak Match", provisional: "Provisional", needs_info: "Needs More Info" };
export const TIER_HELP: Record<Tier, string> = {
  strong: "Scores 75+ with most of the rubric backed by real data.",
  potential: "Scores 55-74 with most of the rubric backed by real data.",
  weak: "Scores under 55 with most of the rubric backed by real data.",
  provisional: "Scored on limited information (under 70% of the rubric had data). The score may change when more is known.",
  needs_info: "Too little information to judge (under 40% of the rubric had data).",
};

export const STAGES = ["new", "sourced", "screening", "shortlisted", "contacted", "interview_scheduled", "interviewed", "assessment", "offer", "hired", "rejected"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { new: "New", sourced: "Sourced", screening: "Screening", shortlisted: "Shortlisted", contacted: "Contacted", interview_scheduled: "Interview Scheduled", interviewed: "Interviewed", assessment: "Assessment", offer: "Offer", hired: "Hired", rejected: "Rejected" };

export type SourceId = "naukri" | "linkedin" | "github" | "cutshort" | "direct";
export const SOURCE_LABEL: Record<string, string> = { naukri: "Naukri", linkedin: "LinkedIn", github: "GitHub", cutshort: "Cutshort", direct: "Direct" };

export interface CandidateRow {
  matchId: string;
  candidateId: string;
  name: string | null;
  headline: string | null;
  experienceYears: number | null;
  location: string | null;
  ctc: string | null;
  noticePeriod: string | null;
  primarySource: string;
  sources: string[];
  avatarUrl: string | null;
  /** Profile addresses on the platforms the person was found on (LinkedIn, Naukri, ...). Open in a new tab. */
  links: Array<{ source: string; url: string }>;
  score: number | null;
  aiScore: number | null;
  tier: Tier | null;
  tierLabel: string | null;
  overridden: boolean;
  overrideReason: string | null;
  stage: string;
  shortlisted: boolean;
  rubricVersion: number | null;
  evidenceCoverage: number | null;
  strengths: string[];
  concerns: string[];
  missingInfo: string[];
  matchedSkills: string[];
  missingSkills: string[];
  hasResume: boolean;
  fullProfile: boolean;
  status: string;
  updatedAt: string;
}

export type DimensionStatus = "confirmed" | "mismatch" | "missing" | "skipped";
export interface DimensionResult {
  score: number | null;
  weight: number;
  status: DimensionStatus;
  evidence: string[];
  note: string;
}
export interface Evaluation {
  id: string;
  total: number;
  tier: Tier;
  rubricVersion: number;
  evidenceCoverage: number;
  dimensions: Record<string, DimensionResult | { band: string }>;
  strengths: string[];
  concerns: string[];
  missingInfo: string[];
  engine: string;
  createdAt: string;
}
export interface MatchDetail {
  links?: Array<{ source: string; url: string }>;
  match: { id: string; stage: string; rejectionReason: string | null; shortlisted: boolean; aiScore: number | null; overrideScore: number | null; overrideTier: string | null; overrideReason: string | null; overrideAt: string | null; job: { id: string; title: string }; candidate: { id: string; name: string | null; headline: string | null; primarySource: string; sources: string[] } };
  evaluation: Evaluation | null;
  history: Array<{ id: string; total: number; tier: Tier; rubricVersion: number; evidenceCoverage: number; engine: string; createdAt: string }>;
  notes: Array<{ id: string; body: string; createdAt: string }>;
  interviews: Array<{ id: string; scheduledAt: string; mode: string; interviewers: string | null; outcome: string | null; notes: string | null }>;
  reminders: Array<{ id: string; dueAt: string; text: string; doneAt: string | null }>;
  events: Array<{ id: string; kind: string; fromStage: string | null; toStage: string | null; data: Record<string, unknown>; createdAt: string }>;
}

export interface RubricDimension { key: string; label: string; weight: number; enabled: boolean; config: Record<string, unknown> }
export interface RubricData { dimensions: RubricDimension[]; custom: Array<{ name: string; weight: number; description?: string; keywords: string[] }> }

export interface SearchFilters {
  boolean: string; useBoolean: boolean; keywords: string[]; anyKeywords: string[]; excludeKeywords: string[]; designation: string[]; previousDesignation: string[];
  minExp: number | null; maxExp: number | null; location: string[]; preferredLocation: string[]; currentCompany: string[]; industry: string[];
  minSalary: number | null; maxSalary: number | null; expectedMinSalary: number | null; expectedMaxSalary: number | null; notice: number | null; education: string; university: string[];
}
export type FieldStatus = "applied" | "unsupported" | "failed" | "attention";
export type RunState = "idle" | "running" | "paused" | "stopped" | "completed";
export interface TaskView {
  id: string; jobId: string; status: string; sourcingState: RunState; aiState: RunState;
  filters: SearchFilters; filterReport: Record<string, { status: FieldStatus; detail?: string }>; configured: string[]; filtersAppliedAt: string | null;
  limits: { maxPages: number; maxCandidates: number; delaySeconds: number }; rubricVersion: number | null;
  counters: { pagesDone: number; captured: number; duplicates: number; analyzed: number; failed: number; aiPending: number; aiFailed: number };
  lastError: string | null;
  events: Array<{ id: string; kind: string; message: string; at: string }>;
  commands: Array<{ id: string; type: string; status: string; result: unknown; createdAt: string; doneAt: string | null }>;
  createdAt: string;
}
export interface ConnectionView { connected: boolean; state: "connected" | "disconnected" | "never"; lastSeenAt: string | null; version: string | null; naukri: string; naukriCheckedAt: string | null }

const send = <T,>(method: string, path: string, json?: unknown) => request<T>(path, { method, ...(json === undefined ? {} : { body: JSON.stringify(json) }) });

export const hunt = {
  connection: () => request<ConnectionView>("/api/hunt/connection"),
  candidates: (jobId: string, q: { source?: string; stage?: string; tier?: string; q?: string; sort?: string; limit?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return request<{ rows: CandidateRow[]; total: number }>(`/api/jobs/${jobId}/candidates?${p}`);
  },
  match: (id: string) => request<MatchDetail>(`/api/matches/${id}`),
  act: (id: string, body: Record<string, unknown>) => send<{ ok: boolean }>("PATCH", `/api/matches/${id}`, body),
  compare: (jobId: string, ids: string[]) => request<{ job: { id: string; title: string }; candidates: Array<CandidateRow & { dimensions: Record<string, DimensionResult>; skills: string[]; certifications: string[] | null }> }>(`/api/jobs/${jobId}/compare?ids=${ids.join(",")}`),
  rubric: (jobId: string) => request<{ version: number; rubric: RubricData; versions: Array<{ id: string; version: number; notes: string | null; createdAt: string }> }>(`/api/jobs/${jobId}/rubric`),
  saveRubric: (jobId: string, rubric: RubricData, notes: string, rescore: boolean) => send<{ version: number; rescored: number | null }>("PUT", `/api/jobs/${jobId}/rubric`, { rubric, notes, rescore }),
  task: (jobId: string) => request<{ task: TaskView | null }>(`/api/jobs/${jobId}/hunt/tasks`),
  newTask: (jobId: string, body: Record<string, unknown> = {}) => send<{ task: TaskView }>("POST", `/api/jobs/${jobId}/hunt/tasks`, body),
  taskById: (id: string) => request<{ task: TaskView }>(`/api/hunt/tasks/${id}`),
  saveTask: (id: string, body: { filters?: SearchFilters; limits?: TaskView["limits"] }) => send<{ task: TaskView }>("PATCH", `/api/hunt/tasks/${id}`, body),
  command: (id: string, type: "check_session" | "apply_filters") => send<{ command: { id: string } }>("POST", `/api/hunt/tasks/${id}/commands`, { type }),
  sourcing: (id: string, action: "start" | "pause" | "resume" | "stop", skipFilters = false) => send<{ state: RunState }>("POST", `/api/hunt/tasks/${id}/sourcing`, { action, skipFilters }),
  ai: (id: string, action: "start" | "pause" | "resume" | "stop") => send<{ state: RunState }>("POST", `/api/hunt/tasks/${id}/ai`, { action }),
  aiRun: (id: string) => send<{ processed: number; failed: number; remaining: number; state: RunState }>("POST", `/api/hunt/tasks/${id}/ai/run`, { limit: 20 }),
  retrieve: (jobId: string, candidateIds: string[]) => send<{ queued: number; unavailable: Array<{ candidateId: string; reason: string }>; taskId: string }>("POST", "/api/hunt/retrievals", { jobId, candidateIds, creditAck: true }),
  retrievals: (jobId: string) => request<{ requests: Array<{ id: string; candidateId: string; status: string; reason: string | null; updatedAt: string }> }>(`/api/hunt/retrievals?jobId=${jobId}`),
  dashboard: () => request<{ totalCandidates: number; shortlisted: number; pendingReview: number; strongMatches: number }>("/api/dashboard"),
  analytics: (q: { from?: string; to?: string; jobId?: string; source?: string }) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
    return request<Analytics>(`/api/analytics?${p}`);
  },
  talentPool: (q: { q?: string; source?: string; offset?: number }) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return request<{ total: number; candidates: Array<{ id: string; links?: Array<{ source: string; url: string }>; name: string; headline: string | null; location: string | null; experienceYears: number | null; primarySource: string; sources: string[]; skills: string[]; hasResume: boolean; jobs: Array<{ matchId: string; jobId: string; jobTitle: string; score: number | null; tier: Tier | null; stage: string }> }> }>(`/api/talent-pool?${p}`);
  },
  team: () => request<{ me: { id: string; role: string }; members: Array<{ id: string; email: string; name: string; role: string; createdAt: string; canSignIn: boolean; google: boolean; lastLoginAt: string | null; extensionKeys: number; jobs: number; candidates: number; extensionOnline: boolean }> }>("/api/team"),
  addMember: (body: { email: string; name?: string; password?: string; role: string }) => send<{ member: { id: string } }>("POST", "/api/team", body),
  updateMember: (body: { memberId: string; role?: string; password?: string }) => send<{ ok: boolean }>("PATCH", "/api/team", body),
};

export interface Analytics {
  totalSourced: number; byPlatform: Record<string, number>; shortlisted: number; awaitingReview: number; stageCounts: Record<string, number>;
  avgDaysInStage: Record<string, number>;
  conversion: Array<{ source: string; sourced: number; shortlisted: number; interviewed: number; offer: number; hired: number; shortlistRate: number; hireRate: number }>;
  quality: Record<string, number>; funnel: Array<{ stage: string; count: number }>;
}
