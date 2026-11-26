import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getErrorStatus, isRetryableError, parseSuggestedDelayMs, withRetry } from "./retry";

class FakeApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

describe("withRetry", () => {
  it("retries 429 and 5xx, then succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new FakeApiError("rate limited", 429);
        if (calls === 2) throw new FakeApiError("unavailable", 503);
        return "ok";
      },
      { sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 },
    );
    assert.equal(result, "ok");
    assert.equal(sleeps.length, 2);
    assert.ok((sleeps[1] ?? 0) > (sleeps[0] ?? 0), "wait grows each time");
  });

  it("does not retry a bad API key (400/403)", async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(
        async () => {
          calls += 1;
          throw new FakeApiError("API key not valid", 400);
        },
        { sleep: async () => {} },
      ),
      /API key/,
    );
    assert.equal(calls, 1);
  });

  it("gives up after maxRetries", async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(
        async () => {
          calls += 1;
          throw new FakeApiError("busy", 503);
        },
        { maxRetries: 2, sleep: async () => {} },
      ),
    );
    assert.equal(calls, 3);
  });

  it("honours Gemini's 'retry in Ns' hint", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new FakeApiError("Quota exceeded. Please retry in 12.4s.", 429);
        return 1;
      },
      { sleep: async (ms) => void sleeps.push(ms), random: () => 0 },
    );
    assert.equal(sleeps[0], 12_400);
  });

  it("helpers classify errors", () => {
    assert.equal(getErrorStatus(new FakeApiError("x", 429)), 429);
    assert.equal(isRetryableError(new TypeError("fetch failed")), true);
    assert.equal(isRetryableError(new Error("something else")), false);
    assert.equal(parseSuggestedDelayMs(new Error("no hint")), null);
  });
});
