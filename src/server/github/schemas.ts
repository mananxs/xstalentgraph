import { z } from "zod";

/**
 * Zod schemas for the GitHub GraphQL responses we use.
 * Everything GitHub may return as null is marked nullable, so one odd profile cannot crash a run.
 */

const languageEdgeSchema = z.object({
  size: z.number(),
  node: z.object({ name: z.string() }),
});

const repositoryNodeSchema = z.object({
  languages: z.object({ edges: z.array(languageEdgeSchema.nullable()).nullable() }).nullable(),
  repositoryTopics: z
    .object({
      nodes: z.array(z.object({ topic: z.object({ name: z.string() }) }).nullable()).nullable(),
    })
    .nullable(),
});

export const userNodeSchema = z.object({
  databaseId: z.number().int().nullable(),
  login: z.string(),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  location: z.string().nullable(),
  createdAt: z.string(),
  avatarUrl: z.string(),
  url: z.string(),
  repositories: z.object({ nodes: z.array(repositoryNodeSchema.nullable()).nullable() }),
});
export type UserNode = z.infer<typeof userNodeSchema>;

/** The shape of `data` for the user-search query. Nodes are validated one by one later. */
export const searchDataSchema = z.object({
  search: z.object({
    userCount: z.number(),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    nodes: z.array(z.unknown()).nullable(),
  }),
  rateLimit: z
    .object({ cost: z.number(), remaining: z.number(), resetAt: z.string() })
    .nullable()
    .optional(),
});
export type SearchData = z.infer<typeof searchDataSchema>;

/** The GraphQL envelope: either data, errors, or both. */
export const envelopeSchema = z.object({
  data: z.unknown().nullable().optional(),
  errors: z
    .array(z.object({ type: z.string().optional(), message: z.string() }))
    .nullable()
    .optional(),
});
