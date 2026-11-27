/** The eleven ATS stages, in order. "hired" and "rejected" are the two exits. */
export const STAGES = ["new", "sourced", "screening", "shortlisted", "contacted", "interview_scheduled", "interviewed", "assessment", "offer", "hired", "rejected"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  sourced: "Sourced",
  screening: "Screening",
  shortlisted: "Shortlisted",
  contacted: "Contacted",
  interview_scheduled: "Interview Scheduled",
  interviewed: "Interviewed",
  assessment: "Assessment",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

export const isStage = (value: unknown): value is Stage => typeof value === "string" && (STAGES as readonly string[]).includes(value);

/** A candidate counts as shortlisted from the Shortlisted stage up to Hired (not when rejected or still early). */
export const SHORTLIST_STAGES: readonly Stage[] = ["shortlisted", "contacted", "interview_scheduled", "interviewed", "assessment", "offer", "hired"];
export const isShortlistedStage = (stage: string): boolean => (SHORTLIST_STAGES as readonly string[]).includes(stage);

export type Tier = "strong" | "potential" | "weak" | "provisional" | "needs_info";
export const TIER_LABEL: Record<Tier, string> = {
  strong: "Strong Match",
  potential: "Potential Match",
  weak: "Weak Match",
  provisional: "Provisional",
  needs_info: "Needs More Info",
};
