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

  it("an UNKNOWN expected CTC is missing information, never a mismatch (and it is only a flag by default)", () => {
    const r = evaluateCandidate(scoringJob, rubric, { ...strong, expectedCtcLpa: null, currentCtcLpa: null });
    assert.equal(r.dimensions.compensation!.status, "missing");
    assert.ok(!r.concerns.some((c) => c.startsWith("Compensation")));
    assert.ok(r.total >= 70, `score must not drop because CTC is unknown: ${r.total}`);
  });

  it("a KNOWN expectation above budget is a flagged mismatch that does not change the score unless it is given a weight", () => {
    const flagged = evaluateCandidate(scoringJob, rubric, { ...strong, expectedCtcLpa: 50 });
    assert.equal(flagged.dimensions.compensation!.status, "mismatch");
    assert.ok(flagged.concerns.some((c) => c.startsWith("Compensation fit") && c.includes("flag only")));
    assert.equal(flagged.total, evaluateCandidate(scoringJob, rubric, strong).total);
    const weighted = sanitizeRubric({ dimensions: [{ key: "compensation", weight: 20, enabled: true, config: { maxLpa: 30 } }] }, rubric);
    assert.ok(evaluateCandidate(scoringJob, weighted, { ...strong, expectedCtcLpa: 50 }).total < flagged.total);
  });

  it("the standard rubric: seven scored factors worth 100, three optional flags worth 0", () => {
    const scored = rubric.dimensions.filter((d) => d.enabled);
    assert.deepEqual(scored.map((d) => [d.key, d.weight]), [["skills", 30], ["experience", 25], ["projects", 15], ["education", 10], ["tools", 10], ["keywords", 5], ["domain", 5]]);
    assert.equal(scored.reduce((s, d) => s + d.weight, 0), 100);
    assert.deepEqual(rubric.dimensions.filter((d) => !d.enabled).map((d) => d.key), ["compensation", "availability", "location"]);
  });

  it("ONE matching factor can never make a candidate look like a perfect fit (the 90-from-career-alone bug)", () => {
    // Exactly the target title and nothing else: no skills, no years, no projects, no tools, no education.
    const titleOnly = evaluateCandidate(scoringJob, rubric, { skills: [], role: "Senior SRE", expYears: null, currentCtcLpa: null, expectedCtcLpa: null, noticeDays: null, text: "Senior SRE" });
    assert.ok(titleOnly.total <= 30, `one factor must not carry the score: ${titleOnly.total}`);
    assert.notEqual(titleOnly.tier, "strong");
    assert.ok(titleOnly.missingInfo.length >= 4, "everything unproven is listed as missing");
    // Every factor shown: strong fit.
    assert.ok(evaluateCandidate(scoringJob, rubric, strong).total > titleOnly.total + 40);
  });

  it("a candidate who proves more factors scores higher than one who proves fewer", () => {
    const some = evaluateCandidate(scoringJob, rubric, { ...strong, education: undefined, text: "SRE at Acme. Kubernetes, Go." });
    const all = evaluateCandidate(scoringJob, rubric, strong);
    assert.ok(all.total > some.total);
    assert.ok(all.evidenceCoverage > some.evidenceCoverage);
  });

  it("a card with little data is Needs More Info / Provisional instead of a confident score", () => {
    const sparse = evaluateCandidate(scoringJob, rubric, { skills: [], expYears: null, currentCtcLpa: null, expectedCtcLpa: null, noticeDays: null, text: "" });
    assert.equal(sparse.tier, "needs_info");
    const partial = evaluateCandidate(scoringJob, rubric, { ...strong, education: undefined, skills: [], expYears: null, text: "SRE at Acme." });
    assert.ok(["provisional", "needs_info"].includes(partial.tier), partial.tier);
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
    assert.equal(r.dimensions.length, 10);
    assert.equal(r.custom.length, 0);
  });
});

describe("legacy rubric upgrade", () => {
  it("upgrades the previous seven-dimension format to the standard one and keeps what the recruiter set", async () => {
    const { isLegacyRubric, upgradeRubric } = await import("./rubric");
    const legacy = {
      dimensions: [
        { key: "skills", label: "Skills", weight: 30, enabled: true, config: { mustHave: ["Go", "Rust"], nice: ["Terraform"] } },
        { key: "experience", label: "Experience", weight: 20, enabled: true, config: { minYears: 8, maxYears: 12 } },
        { key: "compensation", label: "Compensation", weight: 10, enabled: true, config: { maxLpa: 40 } },
        { key: "availability", label: "Availability", weight: 10, enabled: true, config: { maxNoticeDays: 45 } },
        { key: "location", label: "Location", weight: 10, enabled: true, config: { locations: ["Pune"], remote: true } },
        { key: "education", label: "Education", weight: 5, enabled: true, config: { required: ["B.Tech"] } },
        { key: "career", label: "Career Background", weight: 15, enabled: true, config: { targetTitles: ["Staff SRE"], industries: ["Fintech"] } },
      ],
      custom: [{ name: "On-call", weight: 5, keywords: ["pager"] }],
    } as unknown as ReturnType<typeof defaultRubric>;
    assert.equal(isLegacyRubric(legacy), true);
    assert.equal(isLegacyRubric(rubric), false);
    const up = upgradeRubric(legacy, job);
    assert.equal(isLegacyRubric(up), false);
    const get = (k: string) => up.dimensions.find((d) => d.key === k)!;
    assert.deepEqual(get("skills").config.mustHave, ["Go", "Rust"]);
    assert.equal(get("experience").config.minYears, 8);
    assert.deepEqual(get("experience").config.targetTitles, ["Staff SRE"]);
    assert.deepEqual(get("domain").config.industries, ["Fintech"]);
    assert.equal(get("compensation").config.maxLpa, 40);
    assert.deepEqual(get("location").config.locations, ["Pune"]);
    assert.equal(up.custom.length, 1);
    assert.equal(up.dimensions.filter((d) => d.enabled).reduce((s, d) => s + d.weight, 0), 100);
  });
});
