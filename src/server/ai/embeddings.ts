import { getGeminiClient } from "./geminiClient";
import { normaliseModelName } from "./llm";
import { withRetry, type RetryOptions } from "./retry";

/** Default embedding model. Override with EMBEDDING_MODEL in .env if Google retires it. */
export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";
/** Must match the vector(1536) column in the database. */
export const EMBEDDING_DIMENSIONS = 1536;
/** Texts per embedContent request (kept small for the free tier). */
const EMBED_BATCH_SIZE = 50;

/**
 * Scales a vector to length 1 (L2 norm).
 * Gemini only returns normalised vectors at its full 3072 size, so shorter ones must be normalised by us.
 */
export function l2Normalize(vector: number[]): number[] {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return length === 0 ? vector : vector.map((value) => value / length);
}

/** Formats a vector the way pgvector reads it: "[0.1,0.2,0.3]". */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/** The part of the SDK we use, so tests can fake it. */
export interface EmbedApi {
  embedContent(params: {
    model: string;
    contents: string[];
    config: { outputDimensionality: number; taskType: string };
  }): Promise<{ embeddings?: Array<{ values?: number[] }> }>;
}

export interface EmbedOptions {
  api?: EmbedApi;
  /** Defaults to EMBEDDING_MODEL from the environment, then gemini-embedding-001. */
  model?: string;
  retry?: RetryOptions;
}

/**
 * Turns texts into 1536-dimension, L2-normalised embeddings (same order as the input).
 * Requests are batched and retried on 429/5xx.
 * @throws If Gemini returns a different number of vectors or a wrong dimension.
 */
export async function embedTexts(texts: string[], options: EmbedOptions = {}): Promise<number[][]> {
  const api = options.api ?? (getGeminiClient().models as unknown as EmbedApi);
  const model = options.model ?? (normaliseModelName(process.env.EMBEDDING_MODEL ?? "") || DEFAULT_EMBEDDING_MODEL);
  const results: number[][] = [];

  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);

    const response = await withRetry(
      () =>
        api.embedContent({
          model,
          contents: batch,
          config: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: "SEMANTIC_SIMILARITY" },
        }),
      options.retry,
    );

    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(`Gemini returned ${embeddings.length} embeddings for ${batch.length} texts.`);
    }

    for (const embedding of embeddings) {
      const values = embedding.values;
      if (!values || values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${values?.length ?? 0}.`);
      }
      results.push(l2Normalize(values));
    }
  }

  return results;
}
