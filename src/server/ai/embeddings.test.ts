import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMBEDDING_DIMENSIONS, embedTexts, l2Normalize, toVectorLiteral, type EmbedApi } from "./embeddings";

describe("embeddings helpers", () => {
  it("l2Normalize gives length 1", () => {
    const normalised = l2Normalize([3, 4]);
    assert.deepEqual(normalised, [0.6, 0.8]);
    assert.ok(Math.abs(Math.hypot(...l2Normalize([1, 2, 3, 4])) - 1) < 1e-12);
  });

  it("l2Normalize leaves a zero vector alone", () => {
    assert.deepEqual(l2Normalize([0, 0]), [0, 0]);
  });

  it("toVectorLiteral matches the pgvector format", () => {
    assert.equal(toVectorLiteral([0.1, 0.2, -0.3]), "[0.1,0.2,-0.3]");
  });
});

describe("embedTexts", () => {
  const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i % 7) + 1);

  it("requests 1536 dimensions, batches by 50 and normalises results", async () => {
    const batchSizes: number[] = [];
    let dimsRequested = 0;
    const api: EmbedApi = {
      embedContent: async (params) => {
        batchSizes.push(params.contents.length);
        dimsRequested = params.config.outputDimensionality;
        return { embeddings: params.contents.map(() => ({ values: vector() })) };
      },
    };
    const texts = Array.from({ length: 120 }, (_, i) => `text ${i}`);
    const result = await embedTexts(texts, { api });
    assert.deepEqual(batchSizes, [50, 50, 20]);
    assert.equal(dimsRequested, 1536);
    assert.equal(result.length, 120);
    assert.ok(Math.abs(Math.hypot(...(result[0] ?? [])) - 1) < 1e-9);
  });

  it("fails loudly on a wrong dimension", async () => {
    const api: EmbedApi = { embedContent: async () => ({ embeddings: [{ values: [1, 2, 3] }] }) };
    await assert.rejects(embedTexts(["a"], { api }), /Expected 1536/);
  });

  it("fails when the count does not match", async () => {
    const api: EmbedApi = { embedContent: async () => ({ embeddings: [] }) };
    await assert.rejects(embedTexts(["a"], { api }), /0 embeddings for 1 texts/);
  });
});
