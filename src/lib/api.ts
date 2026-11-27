import type {
  BatchDto,
  IntegrationDto,
  JdExtractionDto,
  JobDetailDto,
  JobDraft,
  JobSummary,
  MatchDto,
  ResumeDto,
  SystemStatusDto,
} from "./types";

/**
 * The ONLY place the browser talks to our API.
 * Components and hooks call these functions and never use fetch() directly.
 * Every request has a timeout, so a hung server can never freeze the page.
 */

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** Uploads may wait on AI reading / OCR. */
const UPLOAD_TIMEOUT_MS = 150_000;

export async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const isForm = typeof FormData !== "undefined" && rest.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: isForm ? rest.headers : { "Content-Type": "application/json", ...rest.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ApiClientError(0, "The server took too long to answer. Please try again.");
    }
    // The browser could not reach the server at all (it restarted, or the connection dropped).
    throw new ApiClientError(0, "Cannot reach the server. Check that `npm run dev` is still running.");
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status})`;
    throw new ApiClientError(response.status, message);
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });

export const api = {
  listJobs: () => request<{ jobs: JobSummary[] }>("/api/jobs"),
  getJob: (jobId: string) => request<{ job: JobDetailDto }>(`/api/jobs/${jobId}`),
  createJob: (draft: JobDraft & { source: "manual" | "pasted" | "uploaded"; sourceFileName: string | null; rawText: string | null }) =>
    request<{ job: JobDetailDto }>("/api/jobs", json("POST", draft)),
  updateJob: (jobId: string, draft: Partial<JobDraft>) => request<{ job: JobDetailDto }>(`/api/jobs/${jobId}`, json("PATCH", draft)),
  deleteJob: (jobId: string) => request<{ ok: true }>(`/api/jobs/${jobId}`, { method: "DELETE" }),

  /** Reads a pasted JD (text) or an uploaded JD file into a draft job. Nothing is saved yet. */
  extractJd: (input: { text: string } | { file: File }) => {
    const form = new FormData();
    if ("file" in input) form.append("file", input.file);
    else form.append("text", input.text);
    return request<JdExtractionDto>("/api/jobs/extract", { method: "POST", body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
  },

  listMatches: (jobId: string) => request<{ matches: MatchDto[] }>(`/api/jobs/${jobId}/matches?limit=200`),

  getLatestBatch: (jobId: string) => request<{ batch: BatchDto | null }>(`/api/jobs/${jobId}/batches`),

  getBatch: (jobId: string, batchId: string) => request<{ batch: BatchDto }>(`/api/jobs/${jobId}/batches/${batchId}`),

  /** rescoreOnly = skip the GitHub search and only score candidates that are unscored, failed or Quick-scored. */
  startIngestion: (jobId: string, options: { rescoreOnly: boolean; sources?: Array<"github" | "linkedin" | "cutshort">; maxProfiles?: number }) =>
    request<{ batchId: string }>(`/api/jobs/${jobId}/ingest`, json("POST", options)),

  /** Cutshort only: fetches name / email / phone. The first call for a candidate spends one Cutshort credit. */
  revealContact: (jobId: string, matchId: string) =>
    request<{ name: string | null; email: string | null; phone: string | null; unlockedNow: boolean }>(`/api/jobs/${jobId}/matches/${matchId}/reveal`, { method: "POST" }),

  setShortlisted: (jobId: string, matchId: string, shortlisted: boolean) =>
    request<{ ok: true }>(`/api/jobs/${jobId}/matches/${matchId}`, json("PATCH", { shortlisted })),

  // ---- Resume Match ----
  listResumes: (jobId: string) => request<{ resumes: ResumeDto[] }>(`/api/jobs/${jobId}/resumes`),
  uploadResume: (jobId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ resume: ResumeDto; notice: string | null }>(`/api/jobs/${jobId}/resumes`, {
      method: "POST",
      body: form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  },
  getResume: (resumeId: string) => request<{ resume: ResumeDto; maskedText: string | null }>(`/api/resumes/${resumeId}`),
  updateResume: (resumeId: string, data: { shortlisted?: boolean; maskedText?: string }) =>
    request<{ resume: ResumeDto }>(`/api/resumes/${resumeId}`, json("PATCH", data)),
  deleteResume: (resumeId: string) => request<{ ok: true }>(`/api/resumes/${resumeId}`, { method: "DELETE" }),
  maskResume: (resumeId: string) =>
    request<{ resume: ResumeDto; maskedText: string | null }>(`/api/resumes/${resumeId}/mask`, { method: "POST", timeoutMs: UPLOAD_TIMEOUT_MS }),

  // ---- Platform ----
  listIntegrations: () => request<{ integrations: IntegrationDto[] }>("/api/integrations"),
  systemStatus: () => request<SystemStatusDto>("/api/system"),
  listShortlists: () => request<ShortlistsResponse>("/api/shortlists"),
};

export interface ShortlistsResponse {
  github: Array<{
    id: string;
    score: number | null;
    scoredBy: "ai" | "quick" | "xray" | "extension";
    stage: string;
    tier: string | null;
    matchId: string;
    matchedSkills: string[];
    jobId: string;
    jobTitle: string;
    candidateId: string;
    source: "github" | "linkedin" | "cutshort" | "naukri";
    headline: string | null;
    experienceYears: number | null;
    ctc: string | null;
    noticePeriod: string | null;
    note: string | null;
    hasResume: boolean;
    login: string;
    name: string | null;
    avatarUrl: string | null;
    profileUrl: string;
    location: string | null;
  }>;
  resumes: Array<ResumeDto & { jobTitle: string }>;
}

/** Turns any thrown value into a message a person can read. */
export function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
