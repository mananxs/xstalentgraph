// Runs against a real platform: TG_URL=http://localhost:3101 TG_KEY=... node --test test/platform.integration.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listJobs, ping, saveShortlist } from "../src/platformClient.js";
import { bytesToBase64, sniff } from "../src/resumeCapture.js";

const cfg = { platformUrl: process.env.TG_URL, apiKey: process.env.TG_KEY };
const skip = !cfg.platformUrl;

const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const payload = (id, name) => ({
  job: { title: "Integration test job", requiredSkills: ["Go"] },
  candidate: { naukriId: id, name, headline: "Engineer", skills: ["Go"], phones: [], emails: [] },
  analysis: { score: 70, matchedSkills: ["Go"], missingSkills: [], reason: "test" },
});

describe("resume sniffing (offline)", () => {
  it("accepts documents and rejects a login page", () => {
    assert.equal(sniff(pdf)?.type, "pdf");
    assert.equal(sniff(Buffer.from("<!doctype html><html>login</html>")), null);
  });
});

describe("platform client", { skip }, () => {
  it("pings with the key and rejects a wrong key", async () => {
    assert.equal((await ping(cfg)).ok, true);
    await assert.rejects(() => ping({ ...cfg, apiKey: "wrong-wrong-wrong-wrong" }));
  });
  it("lists jobs", async () => assert.ok(Array.isArray(await listJobs(cfg))));
  it("uploads a CV file and stores it in the platform", async () => {
    const res = await saveShortlist(cfg, payload(`it-${Date.now()}-a`, "Test Person A"), { base64: bytesToBase64(new Uint8Array(pdf)), fileName: "a.pdf", mime: "application/pdf" });
    assert.equal(res.resume, "file");
    assert.equal(res.resumeWarning, null);
  });
  it("keeps two people with the same name apart when their ids differ", async () => {
    const a = await saveShortlist(cfg, payload(`it-${Date.now()}-b1`, "Same Name"));
    const b = await saveShortlist(cfg, payload(`it-${Date.now()}-b2`, "Same Name"));
    assert.notEqual(a.candidateId, b.candidateId);
  });
});
