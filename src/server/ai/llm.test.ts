import assert from "node:assert/strict";
import { describe, it } from "node:test";
import pino from "pino";
import { extractJson, isBadModelError, LlmClient, normaliseModelName, LlmPausedError, nextModeFor, type GenerateApi } from "./llm";

const silent = pino({ level: "silent" });
const err = (status: number, message: string) => Object.assign(new Error(message), { status });

describe("error classification", () => {
  it("treats unknown model names as bad models, but not thinking errors", () => {
    assert.ok(isBadModelError(err(404, "gone")));
    assert.ok(isBadModelError(err(400, "GenerateContentRequest.model: unexpected model name format")));
    assert.ok(isBadModelError(err(400, "models/gemini-9 is not found for API version v1beta")));
    assert.ok(!isBadModelError(err(400, "API key not valid")));
    assert.equal(nextModeFor(err(400, "Thinking budget is not supported for this model"), "budget"), "level");
    assert.equal(nextModeFor(err(400, "thinking_level is not supported"), "level"), "noThinking");
    assert.equal(nextModeFor(err(400, "JSON mode is not enabled"), "budget"), "noSchema");
    assert.equal(nextModeFor(err(400, "Developer instruction is not enabled"), "noSchema"), "plain");
    assert.equal(nextModeFor(err(400, "API key not valid"), "budget"), null);
  });

  it("extracts JSON from fenced or chatty answers", () => {
    assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(extractJson('Here you go: {"a":2} hope it helps'), { a: 2 });
    assert.throws(() => extractJson("no json"));
  });
});

describe("LlmClient", () => {
  it("opens the circuit breaker after repeated total failures, then recovers", async () => {
    let clock = 0;
    let fail = true;
    const api = {
      generateContent: async () => {
        if (fail) throw err(503, "overloaded");
        return { text: "ok" };
      },
    } as unknown as GenerateApi;
    const client = new LlmClient({
      models: ["a"],
      api,
      now: () => clock,
      logger: silent,
      retry: { sleep: async () => {}, maxRetries: 0 },
      breakerThreshold: 2,
      breakerCooldownMs: 1000,
    });

    await assert.rejects(client.generate({ prompt: "x" }));
    await assert.rejects(client.generate({ prompt: "x" }));
    assert.ok(client.isPaused());
    await assert.rejects(client.generate({ prompt: "x" }), LlmPausedError);

    clock = 5000;
    fail = false;
    assert.ok(!client.isPaused());
    assert.equal((await client.generate({ prompt: "x" })).text, "ok");
  });

  it("is not configured without a key, and says so", async () => {
    const client = new LlmClient({ models: ["a"], api: null, logger: silent });
    assert.equal(client.configured, false);
    await assert.rejects(client.generate({ prompt: "x" }), /No AI provider/);
  });

  it("falls back to Groq when every Gemini model fails", async () => {
    const api = { generateContent: async () => { throw err(429, "Quota exceeded for metric generate_content_free_tier_requests PerDay"); } } as unknown as GenerateApi;
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })) as unknown as typeof fetch;
    const client = new LlmClient({ models: ["a"], api, groqApiKey: "k", fetchImpl, logger: silent, retry: { sleep: async () => {} } });
    const result = await client.generateJson({ prompt: "x" });
    assert.deepEqual(result.data, { ok: true });
    assert.match(result.model, /^groq:/);
  });
});

describe("normaliseModelName", () => {
  it("cleans quotes, spaces, comments and the models/ prefix", () => {
    assert.equal(normaliseModelName(' "gemini-flash-latest" '), "gemini-flash-latest");
    assert.equal(normaliseModelName("models/gemini-3.1-flash-lite"), "gemini-3.1-flash-lite");
    assert.equal(normaliseModelName("gemini-flash-latest # main"), "gemini-flash-latest");
  });
  it("rejects names that would make Gemini answer 'unexpected model name format'", () => {
    assert.equal(normaliseModelName("gemini flash"), "");
    assert.equal(normaliseModelName(""), "");
    assert.equal(normaliseModelName("my/model"), "");
  });
});
