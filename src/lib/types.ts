/**
 * Types shared by the API routes (server) and the dashboard (browser).
 * Keep this file free of server-only imports.
 */

export type BatchStatus = "queued" | "running" | "completed" | "failed";

export interface JobSummary {
  id: string;
  title: string;
  createdAt: string;
  matchCount: number;
  /** Who created the job (shown to managers and admins, who see every HR's jobs). */
  ownerId?: string;
  ownerName?: string;
}

/** Full job details (what "current settings" searches with). */
export interface JobDetailDto {
  id: string;
  title: string;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  technologies: string[];
  handsOn: string[];
  languages: string[];
  locations: string[];
  remoteAllowed: boolean;
  experienceYears: number | null;
  seniority: string | null;
  workMode: string | null;
  employmentType: string | null;
  source: string;
  sourceFileName: string | null;
  createdAt: string;
}

/** Editable job fields (create from a JD, or edit the search settings). */
export type JobDraft = Omit<JobDetailDto, "id" | "createdAt" | "source" | "sourceFileName">;

/** Result of reading a pasted / uploaded JD. */
export interface JdExtractionDto {
  draft: JobDraft;
  rawText: string;
  source: "pasted" | "uploaded";
  fileName: string | null;
  extractedBy: string;
  notice: string | null;
}

export interface MatchCandidate {
  id: string;
  /** null for LinkedIn candidates. */
  githubId: string | null;
  source: "github" | "linkedin" | "cutshort" | "naukri";
  login: string;
  name: string | null;
  avatarUrl: string | null;
  profileUrl: string;
  bio: string | null;
  location: string | null;
  headline: string | null;
  skills: string[];
  experienceYears: number | null;
  /** Naukri extras (null for other sources). */
  ctc: string | null;
  noticePeriod: string | null;
  /** One-line fit reasoning from the analysis. */
  note: string | null;
  /** The resume is stored inside the platform (open it at /candidates/:id). */
  hasResume: boolean;
  /** How to reach the candidate. */
  contact: {
    emails: string[];
    phoneNumbers: string[];
    profileUrl: string;
    personalWebsite: string | null;
    otherLinks: string[];
  };
}

export type MatchStatus = "pending" | "completed" | "failed";

export interface MatchDto {
  matchId: string;
  status: MatchStatus;
  /** null while the candidate is still being scored (or scoring failed). */
  score: number | null;
  /** Short reason when status is "failed". */
  error: string | null;
  matchedSkills: string[];
  missingSkills: string[];
  shortlisted: boolean;
  /** "ai" = scored by an AI model, "quick" = offline keyword score (AI was unavailable). null until scored. */
  scoredBy: "ai" | "quick" | "xray" | "extension" | null;
  /** Model that produced the score. */
  model: string | null;
  candidate: MatchCandidate;
}

export interface BatchDto {
  id: string;
  status: BatchStatus;
  /** What the recruiter asked for: run | pause | stop. */
  control: "run" | "pause" | "stop";
  maxProfiles: number;
  profilesFound: number;
  candidatesUpserted: number;
  embeddedCount: number;
  evaluationTotal: number;
  evaluatedCount: number;
  failedCount: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export type SkillStatus = "matched" | "partial" | "missing";

export interface ResumeSkillDto {
  name: string;
  type: "required" | "preferred" | "other";
  status: SkillStatus;
  evidence: string;
  handsOn?: boolean;
  handsOnShown?: boolean;
}

/** A resume analysed against a job (Resume Match module). */
export interface ResumeDto {
  id: string;
  jobId: string;
  code: string;
  fileName: string;
  fileType: string;
  name: string | null;
  label: string;
  summary: string | null;
  candidateYears: number | null;
  requiredYears: number | null;
  skills: ResumeSkillDto[];
  score: number;
  reqHit: number;
  reqTotal: number;
  scoredBy: "ai" | "quick" | "xray" | "extension";
  model: string;
  shortlisted: boolean;
  maskStatus: "none" | "masked" | "failed";
  maskError: string | null;
  createdAt: string;
}

export interface IntegrationDto {
  id: "github" | "linkedin" | "cutshort" | "indeed" | "naukri";
  name: string;
  status: "connected" | "not_connected" | "coming_soon";
  detail: string;
}

export interface SystemStatusDto {
  ai: { provider: string; configured: boolean; paused: boolean; models: string[]; groq: boolean };
  worker: { embedded: boolean };
  sourcing: { maxProfiles: number; displayed: number; linkedin: boolean; cutshort: boolean };
}
