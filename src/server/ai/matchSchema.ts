import { z } from "zod/v4";

/**
 * The exact JSON the model must return. One Zod schema is used twice:
 *  1. converted to JSON Schema, so Gemini is constrained to this shape;
 *  2. used to validate whatever comes back.
 * (zod/v4 is used here because it can export JSON Schema directly.)
 */
export const matchResultSchema = z.object({
  MatchScore: z.number().int().min(0).max(100),
  MatchedSkills: z.array(z.string()),
  MissingSkills: z.array(z.string()),
});

export type RawMatchResult = z.infer<typeof matchResultSchema>;

/** JSON Schema for Gemini's `responseJsonSchema` (without the `$schema` marker Gemini does not need). */
export function getMatchResultJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(matchResultSchema) as Record<string, unknown>;
  return schema;
}

/** Batch review: several candidates scored in ONE call (saves tokens). `id` is the candidate's number in the prompt. */
export const batchResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      MatchScore: z.number().int().min(0).max(100),
      MatchedSkills: z.array(z.string()),
      MissingSkills: z.array(z.string()),
    }),
  ),
});

export function getBatchResultJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(batchResultSchema) as Record<string, unknown>;
  return schema;
}
