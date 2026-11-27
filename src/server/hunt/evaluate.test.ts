import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateCandidate, type CandidateFacts } from "./evaluate";
import { defaultRubric, readJdConstraints, sanitizeRubric } from "./rubric";
import type { JobDetails } from "@/server/repositories/jobRepository";

const job = {
  id: "j", organizationId: "o", title: "Senior SRE", description: "Own reliability. Up to 30 LPA. Notice period 30 days. B.Tech required.",
  requiredSkills: ["Kubernetes", "Go", "AWS"], preferredSkills: ["Terraform"], languages: [], locations: ["Hyderabad"], remoteAllowed: false, technologies: [], handsOn: [],
  experienceYears: 5, seniority: null, workMode: null, employmentType: null, source: "manual", sourceFileName: null, createdAt: new Date(),
} as unknown as JobDetails;
const rubric = defaultRubric(job);
const scoringJob = { title: job.title, description: job.description, requiredSkills: job.requiredSkills, preferredSkills: job.preferredSkills, languages: [], locations: job.locations, remoteAllowed: false, experienceYears: 5, seniority: null };

const strong: CandidateFacts = {
  name: "A", role: "SRE", company: "Acme", skills: ["Kubernetes", "Go", "AWS", "Terraform"], expYears: 7, currentCtcLpa: 24, expectedCtcLpa: 28, noticeDays: 30,
  location: "Hyderabad", education: "B.Tech Computer Science", text: "Built Kubernetes platform on AWS with Go and Terraform, cut deploy time 40% and reduced incidents by 60%. Led SRE team.",
};

describe("JD constraints", () => {
  it("reads budget, notice and education only when the JD states them", () => {
    assert.deepEqual(readJdConstraints(job.description), { maxLpa: 30, maxNoticeDays: 30, education: ["B.Tech"] });
    assert.deepEqual(readJdConstraints("Great job."), { maxLpa: null, maxNoticeDays: null, education: [] });
  });
});

describe("evaluateCandidate", () => {
  it("scores a complete strong candidate as a strong match with full evidence", () => {
    const r = evaluateCandidate(scoringJob, rubric, strong);
    assert.equal(r.tier, "strong");
    assert.ok(r.total >= 75, String(r.total));
    assert.equal(r.evidenceCoverage, 1);
    assert.deepEqual(r.missingInfo, []);
  });

  it("an UNKNOWN expected CTC is missing information, never a mismatch", () => {
    const r = evaluateCandidate(scoringJob, rubric, { ...strong, expectedCtcLpa: null, currentCtcLpa: null });
    assert.equal(r.dimensions.compensation!.status, "missing");
    assert.ok(r.missingInfo.includes("Compensation"));
    assert.ok(!r.concerns.some((c) => c.startsWith("Compensation")));
    assert.ok(r.total >= 70, `score must not drop because CTC is unknown: ${r.total}`);
  });

  it("a KNOWN expectation above budget IS a confirmed mismatch", () => {
    const r = evaluateCandidate(scoringJob, rubric, { ...strong, expectedCtcLpa: 50 });
    assert.equal(r.dimensions.compensation!.status, "mismatch");
    assert.ok(r.concerns.some((c) => c.startsWith("Compensation")));
  });

  it("a card with little data is Needs More Info / Provisional instead of a confident score", () => {
    const sparse = evaluateCandidate(scoringJob, rubric, { skills: [], expYears: null, currentCtcLpa: null, expectedCtcLpa: null, noticeDays: null, text: "" });
    assert.equal(sparse.tier, "needs_info");
    const partial = evaluateCandidate(scoringJob, rubric, { ...strong, expectedCtcLpa: null, currentCtcLpa: null, noticeDays: null, education: undefined, location: undefined });
    assert.equal(partial.tier, "provisional");
  });

  it("a wrong city is a mismatch; remote jobs forgive it", () => {
    const far = evaluateCandidate(scoringJob, rubric, { ...strong, location: "Pune" });
    assert.equal(far.dimensions.location!.status, "mismatch");
    const remote = evaluateCandidate({ ...scoringJob, remoteAllowed: true }, sanitizeRubric({ dimensions: [{ key: "location", weight: 10, enabled: true, config: { remote: true } }] }, rubric), { ...strong, location: "Pune" });
    assert.equal(remote.dimensions.location!.status, "confirmed");
  });

  it("an irrelevant candidate is weak and capped by the must-have gate", () => {
    const r = evaluateCandidate(scoringJob, rubric, { ...strong, skills: ["Sales", "Presentation"], role: "Manager", text: "Sales manager with presentation skills and client relationships." });
    assert.equal(r.band, "weak");
    assert.ok(r.total < 55);
  });

  it("weights are editable and custom criteria count", () => {
    const heavy = sanitizeRubric({ dimensions: [{ key: "skills", weight: 100, enabled: true, config: {} }, { key: "location", weight: 0, enabled: false, config: {} }], custom: [{ name: "On-call", weight: 20, keywords: ["on-call", "pager"] }] }, rubric);
    const r = evaluateCandidate(scoringJob, heavy, { ...strong, text: strong.text + " Carried the on-call pager for 3 years." });
    assert.equal(r.dimensions.location!.weight, 0);
    assert.equal(r.dimensions.custom_0!.status, "confirmed");
  });

  it("sanitizeRubric drops junk and clamps weights", () => {
    const r = sanitizeRubric({ dimensions: [{ key: "skills", weight: 9999, enabled: true, config: { mustHave: ["Go", " "] } }, { key: "bogus", weight: 5 }], custom: [{ name: "", keywords: ["x"] }] }, rubric);
    assert.equal(r.dimensions.find((d) => d.key === "skills")!.weight, 100);
    assert.deepEqual(r.dimensions.find((d) => d.key === "skills")!.config.mustHave, ["Go"]);
    assert.equal(r.dimensions.length, 7);
    assert.equal(r.custom.length, 0);
  });
});
