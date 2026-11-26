import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePrompt, rankCandidates } from "./demoSearch";
import type { SourceId } from "./data";

const ALL = new Set<SourceId>(["naukri", "linkedin", "cutshort", "github"]);

describe("parsePrompt", () => {
  it("reads skills, city and years", () => {
    const parsed = parsePrompt("Senior SRE, K8s + Golang + AWS, Bangalore, 5+ years");
    assert.deepEqual(parsed.skills.sort(), ["aws", "go", "kubernetes"]);
    assert.deepEqual(parsed.cities, ["bengaluru"]);
    assert.equal(parsed.years, 5);
  });
});

describe("rankCandidates", () => {
  it("ranks the full-skill, right-city match first and never mixes people up", () => {
    const { ranked } = rankCandidates("Kubernetes Go AWS Hyderabad 5+ years", ALL);
    assert.ok(ranked.length >= 2);
    for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1]!.score >= ranked[i]!.score);
    assert.equal(new Set(ranked.map((row) => row.candidate.id)).size, ranked.length);
  });
  it("respects the source filter", () => {
    const { ranked } = rankCandidates("python django", new Set<SourceId>(["naukri"]));
    assert.ok(ranked.length > 0 && ranked.every((row) => row.candidate.source === "naukri"));
  });
  it("returns nothing when no skill is recognised", () => {
    assert.equal(rankCandidates("hello world", ALL).ranked.length, 0);
  });
});
