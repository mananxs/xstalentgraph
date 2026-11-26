import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRankMap, passesScoreFilter, sortMatches, topMatches } from "./matches";
import type { MatchDto, MatchStatus } from "./types";

function match(id: string, status: MatchStatus, score: number | null): MatchDto {
  return {
    matchId: id,
    status,
    score,
    error: null,
    matchedSkills: [],
    missingSkills: [],
    shortlisted: false,
    scoredBy: status === "completed" ? "ai" : null,
    model: null,
    candidate: {
      id, githubId: id, source: "github", login: id, name: null, avatarUrl: null, profileUrl: "", bio: null, location: null,
      headline: null, skills: [], experienceYears: null, ctc: null, noticePeriod: null, note: null, hasResume: false,
      contact: { emails: [], phoneNumbers: [], profileUrl: "", personalWebsite: null, otherLinks: [] },
    },
  };
}

describe("sortMatches", () => {
  it("puts scored first (best score first), then scoring, then failed", () => {
    const sorted = sortMatches([
      match("failed", "failed", null),
      match("pending", "pending", null),
      match("low", "completed", 40),
      match("high", "completed", 90),
    ]);
    assert.deepEqual(sorted.map((m) => m.matchId), ["high", "low", "pending", "failed"]);
  });

  it("re-ranks when a pending candidate gets a score", () => {
    const before = [match("a", "completed", 70), match("b", "pending", null)];
    assert.deepEqual(sortMatches(before).map((m) => m.matchId), ["a", "b"]);

    const after = [match("a", "completed", 70), match("b", "completed", 95)];
    assert.deepEqual(sortMatches(after).map((m) => m.matchId), ["b", "a"]);
  });

  it("does not change the input array", () => {
    const input = [match("a", "pending", null), match("b", "completed", 10)];
    sortMatches(input);
    assert.equal(input[0]?.matchId, "a");
  });
});

describe("buildRankMap", () => {
  it("ranks only scored candidates, starting at 1", () => {
    const ranks = buildRankMap([match("a", "completed", 50), match("b", "pending", null), match("c", "completed", 80)]);
    assert.equal(ranks.get("c"), 1);
    assert.equal(ranks.get("a"), 2);
    assert.equal(ranks.has("b"), false);
  });
});

describe("passesScoreFilter", () => {
  it("applies the minimum to scored candidates and hides unscored ones above 0", () => {
    assert.equal(passesScoreFilter(match("a", "completed", 60), 60), true);
    assert.equal(passesScoreFilter(match("a", "completed", 59), 60), false);
    assert.equal(passesScoreFilter(match("p", "pending", null), 0), true);
    assert.equal(passesScoreFilter(match("p", "pending", null), 5), false);
  });
});

describe("topMatches", () => {
  it("keeps only the best N in display order, scored first", () => {
    const all = [
      ...Array.from({ length: 12 }, (_, index) => match(`s${index}`, "completed", index * 5)),
      match("pending", "pending", null),
    ];
    const top = topMatches(all, 10);
    assert.equal(top.length, 10);
    assert.equal(top[0]?.matchId, "s11");
    assert.ok(!top.some((item) => item.matchId === "pending"), "unscored candidates do not push out scored ones");
  });

  it("fills up with candidates still scoring when fewer than N are scored", () => {
    const top = topMatches([match("a", "completed", 80), match("p", "pending", null), match("f", "failed", null)], 10);
    assert.deepEqual(top.map((item) => item.matchId), ["a", "p", "f"]);
  });
});
