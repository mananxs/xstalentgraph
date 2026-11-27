import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { withAiScope } from "@/server/ai/scope";
import type { JobDetails } from "@/server/repositories/jobRepository";
import { aiEngine, isAiEngine, judgeCandidate, readJudgement, RULES_ENGINE } from "./aiJudge";
import { evaluateCandidate, type CandidateFacts } from "./evaluate";
import { defaultRubric } from "./rubric";

const job = {
  id: "j", organizationId: "o", title: "Senior SRE", description: "Own reliability. Up to 30 LPA. Notice period 30 days. B.Tech required.",
  requiredSkills: ["Kubernetes", "Go", "AWS"], preferredSkills: ["Terraform"], languages: [], locations: ["Hyderabad"], remoteAllowed: false, technologies: [], handsOn: [],
  experienceYears: 5, seniority: null, workMode: null, employmentType: null, source: "manual", sourceFileName: null, createdAt: new Date(),
} as unknown as JobDetails;
const rubric = defaultRubric(job);
const sj = { title: job.title, description: job.description, requiredSkills: job.requiredSkills, preferredSkills: job.preferredSkills, languages: [], locations: job.locations, remoteAllowed: false, experienceYears: 5, seniority: null };
const facts: CandidateFacts = { name: "Asha Rao", role: "SRE", company: "Acme", skills: ["Kubernetes", "Go"], expYears: 7, currentCtcLpa: 24, expectedCtcLpa: 28, noticeDays: 30, location: "Hyderabad", education: "B.Tech Computer Science", text: "Asha Rao. Built Kubernetes platform on AWS with Go, cut deploy time 40% and reduced incidents by 60%. Led SRE team." };

const realFetch = globalThis.fetch;
let replies: unknown[];
let calls = 0;
beforeEach(() => {
  calls = 0;
  process.env.GROQ_API_KEY = "platform-groq-key-0000000000";
  process.env.GROQ_MODELS = "openai/gpt-oss-20b";
  globalThis.fetch = (async () => {
    calls += 1;
    const body = replies[Math.min(calls - 1, replies.length - 1)];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const good = (over: Record<string, unknown> = {}) => ({
  candidateName: "Asha Rao", summary: "Strong SRE with hands-on Kubernetes and AWS.", matchedMustHave: ["Kubernetes", "Go", "AWS"], missingMustHave: [],
  dimensions: {
    skills: { score: 90, reason: "Built a Kubernetes platform on AWS with Go.", evidence: ["Built Kubernetes platform on AWS with Go", "a quote the candidate never wrote"] },
    experience: { score: 100, reason: "7 years against 5 required.", evidence: [] },
    compensation: { score: 100, reason: "Expects 28 LPA, budget 30.", evidence: [] },
    availability: { score: null, reason: "Not stated.", evidence: [] },
    location: { score: 100, reason: "Hyderabad.", evidence: [] },
    education: { score: 100, reason: "B.Tech.", evidence: [] },
    career: { score: 80, reason: "SRE who led a team.", evidence: ["Led SRE team"] },
  },
  ...over,
});

describe("AI judge", () => {
  it("scores with the model and computes the rubric-weighted total", async () => {
    replies = [good()];
    const j = await withAiScope(() => judgeCandidate(sj, rubric, facts));
    assert.ok(isAiEngine(j.engine), j.engine);
    assert.equal(j.summary, "Strong SRE with hands-on Kubernetes and AWS.");
    const d = j.result.dimensions;
    assert.equal(d.skills!.score, 90);
    assert.equal(d.availability!.status, "missing", "null from the model = missing information, not zero");
    // weighted mean over the dimensions that have a score (availability excluded): (90*30+100*20+100*10+100*10+100*5+80*15)/(30+20+10+10+5+15)
    assert.equal(j.result.total, Math.round((90 * 30 + 100 * 20 + 100 * 10 + 100 * 10 + 100 * 5 + 80 * 15) / 90));
  });
  it("keeps only evidence that is really in the candidate's text", async () => {
    replies = [good()];
    const j = await withAiScope(() => judgeCandidate(sj, rubric, { ...facts, text: facts.text + " " }));
    assert.deepEqual(j.result.dimensions.skills!.evidence, ["Built Kubernetes platform on AWS with Go"]);
  });
  it("is deterministic: the same card is not sent to the model twice", async () => {
    replies = [good()];
    const f = { ...facts, text: facts.text + " unique-1" };
    const a = await withAiScope(() => judgeCandidate(sj, rubric, f));
    const b = await withAiScope(() => judgeCandidate(sj, rubric, f));
    assert.equal(a.result.total, b.result.total);
    assert.equal(calls, 1);
  });
  it("caps the score when the model finds under half of the must-have skills", async () => {
    replies = [good({ matchedMustHave: ["Go"], missingMustHave: ["Kubernetes", "AWS"] })];
    const j = await withAiScope(() => judgeCandidate(sj, rubric, { ...facts, text: facts.text + " unique-2" }));
    assert.ok(j.result.total <= 70);
  });
  it("refuses an answer about a different person and falls back to the labelled rule engine", async () => {
    replies = [good({ candidateName: "Someone Else" })];
    const j = await withAiScope(() => judgeCandidate(sj, rubric, { ...facts, text: facts.text + " unique-3" }));
    assert.equal(j.engine, RULES_ENGINE);
    assert.equal(j.result.total, evaluateCandidate(sj, rubric, { ...facts, text: facts.text + " unique-3" }).total);
    assert.match(j.aiError ?? "", /did not match/);
  });
  it("uses the rule engine, labelled, when no AI is available or it is switched off", async () => {
    delete process.env.GROQ_API_KEY;
    const off = await judgeCandidate(sj, rubric, facts, { ai: false });
    assert.equal(off.engine, RULES_ENGINE);
    assert.equal(aiEngine("m"), "ai:m");
  });
  it("rejects malformed answers", () => {
    const base = evaluateCandidate(sj, rubric, facts);
    assert.equal(readJudgement({ nope: true }, facts, base), null);
    assert.equal(readJudgement({ candidateName: "Asha Rao", dimensions: { skills: { score: "high" } } }, facts, base), null);
  });
});
