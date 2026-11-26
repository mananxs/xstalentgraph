export type ScoreTier = "high" | "mid" | "low";

export interface ScoreTierInfo {
  tier: ScoreTier;
  /** Human label, also used in aria-labels. */
  label: string;
  /** Hex color from the design palette. */
  color: string;
}

/** Green for 80+, amber for 60-79, rose for under 60. */
export function getScoreTier(score: number): ScoreTierInfo {
  if (score >= 80) return { tier: "high", label: "Strong match", color: "#15803d" };
  if (score >= 60) return { tier: "mid", label: "Possible match", color: "#b45309" };
  return { tier: "low", label: "Weak match", color: "#be123c" };
}
