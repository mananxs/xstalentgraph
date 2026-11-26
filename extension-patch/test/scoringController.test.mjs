import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createScoringController } from "../src/scoringController.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const card = (n) => ({ key: `k${n}`, name: `P${n}` });

describe("scoringController", () => {
  it("never scores while stopped (the default)", async () => {
    const scored = [];
    const c = createScoringController({ scoreCard: async (x) => scored.push(x.key) });
    [1, 2, 3].forEach((n) => c.offer(card(n)));
    await wait(50);
    assert.deepEqual(scored, []);
    assert.equal(c.snapshot().waiting, 3);
    assert.equal(c.isRunning(), false);
  });

  it("drains the waiting cards on start, then returns to stopped", async () => {
    const scored = [];
    const c = createScoringController({ scoreCard: async (x) => { await wait(5); scored.push(x.key); } });
    [1, 2, 3].forEach((n) => c.offer(card(n)));
    c.start();
    await wait(200);
    assert.deepEqual(scored.sort(), ["k1", "k2", "k3"]);
    assert.equal(c.isRunning(), false);
  });

  it("stops promptly and keeps unscored cards waiting", async () => {
    const scored = [];
    const c = createScoringController({ concurrency: 1, scoreCard: async (x) => { await wait(40); scored.push(x.key); } });
    [1, 2, 3, 4].forEach((n) => c.offer(card(n)));
    c.start();
    await wait(60);
    c.stop();
    await wait(150);
    assert.ok(scored.length < 4);
    assert.ok(c.snapshot().waiting >= 1);
  });

  it("does not score the same card twice", async () => {
    let calls = 0;
    const c = createScoringController({ scoreCard: async () => { calls++; } });
    c.offer(card(1)); c.offer(card(1)); c.start();
    await wait(100);
    c.offer(card(1));
    await wait(50);
    assert.equal(calls, 1);
  });

  it("stops and keeps the card when scoring throws", async () => {
    const warn = console.warn; console.warn = () => {};
    const c = createScoringController({ scoreCard: async () => { throw new Error("quota"); } });
    c.offer(card(1)); c.start();
    await wait(80);
    console.warn = warn;
    assert.equal(c.isRunning(), false);
    assert.equal(c.snapshot().waiting, 1);
  });
});
