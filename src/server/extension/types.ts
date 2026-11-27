/** Shapes exchanged with the XS-Hunt browser extension (mirror of the extension's src/shared/types.ts). */

export interface CardExtracted {
  fullName: string;
  currentRole: string;
  currentCompany: string;
  headline: string;
  skills: string[];
  expYears: number; // -1 unknown
  currentCtcLpa: number; // -1 unknown
  expectedCtcLpa: number; // -1 unknown
  location: string;
  /** Extra facts read from the card (optional so older clients still type-check). */
  education?: string;
  previous?: string;
  prefLocations?: string;
}

export type Worth = "open" | "review" | "skip";

export interface CardResult {
  domId: string;
  key?: string;
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
  worth?: Worth;
  worthReasons?: string[];
  extracted?: CardExtracted;
}

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

export interface Rubric {
  title: string;
  seniority: string;
  mustHaveSkills: string[];
  importantSkills?: string[];
  niceToHaveSkills: string[];
  dealBreakers?: string[];
  targetTitles?: string[];
  minExperienceYears: number;
  maxExperienceYears: number;
  maxNoticePeriodDays: number;
  ctcBudgetMinLpa: number;
  ctcBudgetMaxLpa: number;
  locations: string[];
  remotePolicy: string;
  domainContext: string;
  coreKeywords: string[];
  booleanQuery?: string;
  mustHaveKeywords?: string[];
  excludeKeywords?: string[];
  minExp?: number;
  maxExp?: number;
}

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
  rubricHash: string;
  search: ResdexPlan | null;
}
