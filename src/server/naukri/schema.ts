import { createHash } from "node:crypto";
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const list = (max = 60) => z.array(text(120)).max(max).default([]);

/** What the Naukri extension sends when a card is saved to the shortlist. */
export const shortlistPayloadSchema = z.object({
  job: z
    .object({
      id: z.string().uuid().optional(),
      title: text(200).optional(),
      description: text(60_000).optional(),
      requiredSkills: list(),
      preferredSkills: list(),
      locations: list(20),
      experienceYears: z.number().min(0).max(60).nullish(),
    })
    .default({ requiredSkills: [], preferredSkills: [], locations: [] }),
  candidate: z.object({
    /** Stable key of the person on Naukri (the extension derives it from the profile link or id). */
    naukriId: text(200).optional(),
    name: text(200).min(1),
    headline: text(300).nullish(),
    location: text(200).nullish(),
    experienceYears: z.number().min(0).max(70).nullish(),
    ctc: text(80).nullish(),
    noticePeriod: text(80).nullish(),
    skills: list(),
    emails: z.array(z.string().trim().email().max(200)).max(5).default([]),
    phones: z.array(text(40)).max(5).default([]),
    /** Naukri profile link. Opens only for a logged-in Resdex recruiter, so the platform never treats it as the resume. */
    profileUrl: text(1000).nullish(),
    avatarUrl: text(1000).nullish(),
    summary: text(4000).nullish(),
  }),
  analysis: z.object({
    score: z.number().min(0).max(100),
    matchedSkills: list(),
    missingSkills: list(),
    reason: text(2000).nullish(),
  }),
  /** Plain text of the CV, used when the file itself could not be downloaded. */
  resumeText: z.string().max(200_000).nullish(),
  /** File name of the uploaded resume (the real name from Naukri). */
  resumeFileName: text(255).optional(),
});

export type ShortlistPayload = z.infer<typeof shortlistPayloadSchema>;

const norm = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The key a Naukri candidate is stored under. The extension should always send naukriId; when it cannot, a hash of
 * name + headline + location + experience is used, so two DIFFERENT people never collapse into one row and the same
 * person re-saved later updates the same row.
 */
export function naukriKey(candidate: ShortlistPayload["candidate"]): string {
  const given = candidate.naukriId?.trim();
  if (given) return given.toLowerCase();
  const basis = [candidate.name, candidate.headline, candidate.location, candidate.experienceYears ?? ""].map((part) => norm(String(part ?? ""))).join("|");
  return `h_${createHash("sha1").update(basis).digest("hex").slice(0, 20)}`;
}

/** Text used for searching and for the AI later: public career facts only, never contact details. */
export function naukriProfileText(payload: ShortlistPayload): string {
  const { candidate } = payload;
  return [
    candidate.name && `Name: ${candidate.name}`,
    candidate.headline && `Current role: ${candidate.headline}`,
    candidate.location && `Location: ${candidate.location}`,
    candidate.experienceYears != null && `Experience: ${candidate.experienceYears} years`,
    candidate.skills.length > 0 && `Skills: ${candidate.skills.join(", ")}`,
    candidate.summary,
  ]
    .filter(Boolean)
    .join("\n");
}
