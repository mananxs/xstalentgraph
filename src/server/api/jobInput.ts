import { z } from "zod";

const list = (max: number) =>
  z
    .array(z.string().trim().max(80))
    .max(max)
    .default([])
    .transform((items) => [...new Set(items.filter(Boolean))]);

/** Validates job fields sent by the browser (create from JD, or edit search settings). */
export const jobDraftSchema = z.object({
  title: z.string().trim().min(2, "Give the job a title.").max(160),
  description: z.string().trim().max(20_000).default(""),
  requiredSkills: list(40),
  preferredSkills: list(40),
  technologies: list(40),
  handsOn: list(40),
  languages: list(6),
  locations: list(8),
  remoteAllowed: z.boolean().default(false),
  experienceYears: z.number().min(0).max(60).nullable().default(null),
  seniority: z.string().trim().max(40).nullable().default(null),
  workMode: z.string().trim().max(40).nullable().default(null),
  employmentType: z.string().trim().max(40).nullable().default(null),
});

export type JobDraftInput = z.infer<typeof jobDraftSchema>;
