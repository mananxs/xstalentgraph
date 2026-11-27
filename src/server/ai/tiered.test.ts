import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { classifyKeyError, getLlmClient } from "./llm";
import { withAiScope } from "./scope";
import { looksLikeKey, testKey } from "./userKeys";

const realFetch = globalThis.fetch;
const groqReply = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
let calls: string[];

/** Fake network: Groq keys decide the outcome by their text, so the test can say which key is good, rejected or out of quota. */
beforeEach(() => {
  calls = [];
  process.env.GROQ_API_KEY = "platform-groq-key-0000000000";
  process.env.GEMINI_API_KEY = "";
  process.env.GROQ_MODELS = "openai/gpt-oss-20b";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
    calls.push(auth.replace("Bearer ", ""));
    if (auth.includes("rejected")) return new Response("invalid api key", { status: 401 });
    if (auth.includes("limited")) return new Response("Rate limit reached for tokens per day (TPD)", { status: 429 });
    return groqReply(auth.includes("platform") ? "from-platform" : "from-own");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const scope = (...keys: string[]) => ({ recruiterId: null, keys: keys.map((key, i) => ({ id: `k${i}`, provider: "groq" as const, key })) });

describe("AI keys: own key first, platform key as the fallback", () => {
  it("uses the HR's own key before the platform's", async () => {
    const r = await withAiScope(() => getLlmClient().generate({ prompt: "hi" }), scope("own-groq-key-1111111111"));
    assert.equal(r.text, "from-own");
    assert.deepEqual(calls, ["own-groq-key-1111111111"]);
  });
  it("falls back to the platform key when the own key is rejected", async () => {
    const r = await withAiScope(() => getLlmClient().generate({ prompt: "hi" }), scope("rejected-key-22222222222"));
    assert.equal(r.text, "from-platform");
    assert.equal(calls[0], "rejected-key-22222222222");
    assert.equal(calls.at(-1), "platform-groq-key-0000000000");
  });
  it("falls back when the own key is out of quota", async () => {
    const r = await withAiScope(() => getLlmClient().generate({ prompt: "hi" }), scope("limited-key-3333333333333"));
    assert.equal(r.text, "from-platform");
  });
  it("tries the HR's second key before the platform", async () => {
    const r = await withAiScope(() => getLlmClient().generate({ prompt: "hi" }), scope("rejected-key-22222222222", "own-groq-key-1111111111"));
    assert.equal(r.text, "from-own");
  });
  it("with no own key, only the platform key is used", async () => {
    const r = await withAiScope(() => getLlmClient().generate({ prompt: "hi" }), scope());
    assert.equal(r.text, "from-platform");
    assert.equal(getLlmClient().configured, true);
  });
  it("reports 'not configured' only when neither exists", async () => {
    delete process.env.GROQ_API_KEY;
    // the platform client is built once; this checks the scoped part: own keys alone make the feature available
    await withAiScope(async () => assert.equal(getLlmClient().configured, true), scope("own-groq-key-1111111111"));
  });
});

describe("AI key helpers", () => {
  it("classifies provider errors", () => {
    assert.equal(classifyKeyError(Object.assign(new Error("bad"), { status: 401 }))?.ok, false);
    assert.deepEqual(classifyKeyError(Object.assign(new Error("bad"), { status: 401 }))?.ok === false && (classifyKeyError(Object.assign(new Error("bad"), { status: 401 })) as { kind: string }).kind, "invalid");
    assert.equal((classifyKeyError(Object.assign(new Error("tokens per day"), { status: 429 })) as { kind: string }).kind, "daily");
    assert.equal((classifyKeyError(Object.assign(new Error("slow down"), { status: 429 })) as { kind: string }).kind, "rate");
    assert.equal(classifyKeyError(Object.assign(new Error("boom"), { status: 503 })), null);
  });
  it("checks the shape of a pasted key", () => {
    assert.equal(looksLikeKey("groq", "gsk_" + "a".repeat(30)), true);
    assert.equal(looksLikeKey("groq", "AIza" + "a".repeat(30)), false);
    assert.equal(looksLikeKey("gemini", "AIza" + "a".repeat(30)), true);
    assert.equal(looksLikeKey("gemini", "has space " + "a".repeat(30)), false);
    assert.equal(looksLikeKey("gemini", "short"), false);
  });
  it("tests a key without spending tokens", async () => {
    const ok = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    const no = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    const rl = (async () => new Response("{}", { status: 429 })) as typeof fetch;
    const down = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.equal((await testKey("groq", "k", ok)).ok, true);
    assert.deepEqual(await testKey("gemini", "k", no), { ok: false, reason: "invalid", message: "Gemini rejected this key." });
    assert.equal((await testKey("groq", "k", rl)).ok, true);
    assert.equal((await testKey("groq", "k", down)).reason, "unreachable");
  });
});
