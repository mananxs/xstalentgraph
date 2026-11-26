import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSkills, scoreResume } from "./analyze";

describe("resume scoring (CandidateMatch weights)", () => {
  const job = { requiredSkills: ["Python", "SQL"], preferredSkills: ["AWS"], technologies: ["Git"], handsOn: ["Python"], experienceYears: 5 };

  it("builds a deduplicated skill list with types and hands-on flags", () => {
    const skills = buildSkills({ ...job, preferredSkills: ["AWS", "python"] });
    assert.deepEqual(skills.map((s) => [s.name, s.type]), [["Python", "required"], ["SQL", "required"], ["AWS", "preferred"], ["Git", "other"]]);
    assert.equal(skills[0]?.handsOn, true);
  });

  it("weights required x3, preferred x1.5, other x0.6 and penalises missing experience", () => {
    const skills = buildSkills(job).map((s) => ({ ...s, status: "matched" as const, evidence: "", handsOnShown: true }));
    assert.equal(scoreResume(skills, 6, 5).score, 100);
    assert.equal(scoreResume(skills, 3, 5).score, 70); // capped at -30%
    const partial = skills.map((s) => (s.name === "AWS" ? { ...s, status: "missing" as const } : s));
    assert.equal(scoreResume(partial, null, null).score, Math.round(((3 + 3 + 0.6) / (3 + 3 + 1.5 + 0.6)) * 100));
  });

  it("gives half credit to a hands-on skill that is only listed", () => {
    const skills = buildSkills(job).map((s) => ({ ...s, status: "matched" as const, evidence: "", handsOnShown: false }));
    assert.equal(scoreResume(skills, null, null).reqHit, 1.5);
  });
});
