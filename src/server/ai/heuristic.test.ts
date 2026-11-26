import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProfileText, buildSerpProfileText } from "./profileText";
import {
  hasTerm,
  heuristicExtractJd,
  heuristicMask,
  heuristicMatch,
  heuristicResumeAnalysis,
  SCORE_WEIGHTS,
  scoreCandidate,
  TIER1_THRESHOLD,
  textHasSkill,
} from "./heuristic";

const job = {
  title: "Senior Python engineer",
  description: "",
  requiredSkills: ["Python", "FastAPI", "PostgreSQL"],
  preferredSkills: ["Docker", "Kubernetes"],
  languages: ["Python"],
  locations: ["Berlin"],
  remoteAllowed: false,
};

describe("hasTerm / textHasSkill", () => {
  it("matches whole tokens and symbols, not substrings", () => {
    assert.ok(hasTerm("I write C++ and Node.js", "C++"));
    assert.ok(hasTerm("I write C++ and Node.js", "Node.js"));
    assert.ok(!hasTerm("React developer", "R"));
    assert.ok(!hasTerm("javascript", "java"));
  });
  it("uses umbrella terms one way only", () => {
    assert.ok(textHasSkill("Optimised MySQL queries", "SQL"));
    assert.ok(!textHasSkill("PostgreSQL and SQL", "MySQL"));
    assert.ok(!textHasSkill("Terraform modules", "HCL"));
  });
  it("understands synonyms", () => {
    assert.ok(textHasSkill("Ran Postgres in production", "PostgreSQL"));
    assert.ok(textHasSkill("Deployed on k8s", "Kubernetes"));
  });
});

describe("scoreCandidate (weighted model)", () => {
  const now = new Date("2026-11-18");
  const saasJob = {
    title: "Senior React Developer",
    description: "We are a SaaS company building B2B analytics. 5+ years of experience.",
    requiredSkills: ["React", "TypeScript", "Node.js"],
    preferredSkills: ["AWS", "GraphQL"],
    languages: ["TypeScript"],
    locations: ["Bangalore"],
    remoteAllowed: false,
    experienceYears: 5,
    seniority: "Senior",
  };
  const profile = (headline: string, snippet: string): string => buildSerpProfileText({ headline, snippet, location: "Bengaluru" });
  const score = (text: string, job = saasJob) => scoreCandidate(job, text, { now });

  const ideal = profile(
    "Senior React Developer - Freshworks",
    "2019 - Present: Led a team of 6 building React and TypeScript apps on Node.js at a SaaS company; reduced page load by 40%, scaled to 2M users. Skills: React, TypeScript, Node.js, AWS, GraphQL.",
  );

  it("weights add up to 100%: 40 skills, 30 experience, 15 impact, 15 industry", () => {
    assert.deepEqual(SCORE_WEIGHTS, { skills: 0.4, experience: 0.3, impact: 0.15, industry: 0.15 });
    assert.equal(Math.round((SCORE_WEIGHTS.skills + SCORE_WEIGHTS.experience + SCORE_WEIGHTS.impact + SCORE_WEIGHTS.industry) * 100), 100);
  });

  it("ranks an ideal profile Tier 1 and an off-field profile far below", () => {
    const best = score(ideal);
    const wrong = score(profile("Java Backend Developer - TCS", "Spring Boot, Hibernate, MySQL microservices. Built payment APIs."));
    assert.ok(best.score > TIER1_THRESHOLD, `ideal scored ${best.score}`);
    assert.ok(wrong.score < 25, `off-field scored ${wrong.score}`);
    assert.deepEqual(best.missingSkills, []);
    assert.equal(best.model, "heuristic");
    assert.equal(best.mustHaveCoverage, 1);
  });

  it("counts a missing must-have more than a missing nice-to-have", () => {
    const noAws = score(profile("Senior React Developer", "React, TypeScript, Node.js, GraphQL"));
    const noNode = score(profile("Senior React Developer", "React, TypeScript, AWS, GraphQL"));
    assert.ok(noAws.breakdown.skills > noNode.breakdown.skills, `${noAws.breakdown.skills} vs ${noNode.breakdown.skills}`);
  });

  it("gives partial skill credit for related skills, but not full", () => {
    const related = score(profile("Software Engineer", "Next.js and Redux developer, JavaScript and Express"));
    const exact = score(profile("Software Engineer", "React, TypeScript and Node.js developer"));
    assert.ok(related.breakdown.skills > 0 && related.breakdown.skills < exact.breakdown.skills);
    assert.deepEqual(related.matchedSkills, []); // related is not direct evidence
  });

  it("prefers skills used in recent roles over older ones", () => {
    const recent = score(profile("Engineer", "2024 - Present: built UIs in React. 2015 - 2018: ops work."));
    const old = score(profile("Engineer", "2024 - Present: ops work. 2011 - 2014: built UIs in React."));
    assert.ok(recent.breakdown.experience > old.breakdown.experience, `${recent.breakdown.experience} vs ${old.breakdown.experience}`);
  });

  it("rewards action verbs and metrics, and ignores phone numbers and connection counts", () => {
    const base = "Frontend engineer using React";
    const impact = score(profile("Frontend Engineer", `${base}. Led migration, reduced latency by 40%, scaled to 2M users, launched 3 products.`));
    const plain = score(profile("Frontend Engineer", base));
    const noise = score(profile("Frontend Engineer", `${base}. Call 98765 01234. 500+ connections on LinkedIn. 2019 - 2023.`));
    assert.ok(impact.breakdown.impact >= 60, `impact ${impact.breakdown.impact}`);
    assert.equal(plain.breakdown.impact, 0);
    assert.equal(noise.breakdown.impact, 0);
  });

  it("scores industry: same domain > adjacent domain > none; neutral when the job names none", () => {
    const text = (company: string) => profile("Senior React Developer", `React TypeScript Node.js at ${company}`);
    const saas = score(text("Freshworks (SaaS)")).breakdown.industry;
    const fintech = score(text("Razorpay")).breakdown.industry;
    const retail = score(text("Flipkart")).breakdown.industry;
    assert.ok(saas > fintech && fintech > retail, `${saas} ${fintech} ${retail}`);
    assert.equal(score(text("Flipkart"), { ...saasJob, description: "Build great products." }).breakdown.industry, 50);
  });

  it("caps a candidate with under half of the must-haves below Tier 1, however good the rest looks", () => {
    const text = profile(
      "Senior Engineer - Freshworks (SaaS)",
      "2019 - Present: Led a team, reduced cost by 40%, scaled to 2M users, built platforms, shipped features. Skills: React, AWS, GraphQL.",
    );
    const result = score(text);
    assert.ok(result.mustHaveCoverage < 0.5);
    assert.ok(result.score <= 75, `scored ${result.score}`);
  });

  it("matches synonyms and treats a URL-only candidate as low-evidence, not an error", () => {
    assert.ok(score(profile("Dev", "Built UIs with reactjs, TS and nodejs")).matchedSkills.includes("React"));
    const empty = score("No public profile information available.");
    assert.ok(empty.score >= 0 && empty.score < 20);
  });

  it("is deterministic and keeps every dimension in 0-100", () => {
    const a = score(ideal);
    assert.deepEqual(a, score(ideal));
    for (const value of Object.values(a.breakdown)) assert.ok(value >= 0 && value <= 100);
  });

  it("still scores GitHub-style profile text (languages and topics count as skill evidence)", () => {
    const github = buildProfileText({ bio: "Backend dev: FastAPI, Postgres", location: "Berlin", topLanguages: { Python: 0.8 }, topics: ["fastapi"] });
    const result = heuristicMatch(job, github);
    assert.ok(result.matchedSkills.includes("Python") && result.matchedSkills.includes("FastAPI"));
    assert.ok(result.score > 0 && result.score <= 100);
  });
});

describe("heuristicExtractJd", () => {
  it("reads title, skills, languages, location, remote and years", () => {
    const jd = heuristicExtractJd(`Senior Backend Engineer
Location: Bengaluru, India (Hybrid)
We need 5+ years of experience with Python, Django and PostgreSQL. You will build REST APIs.
Nice to have: AWS, Docker, Kubernetes`);
    assert.equal(jd.title, "Senior Backend Engineer");
    assert.ok(jd.requiredSkills.includes("Python") && jd.requiredSkills.includes("Django"));
    assert.ok(jd.preferredSkills.includes("Docker"));
    assert.ok(!jd.requiredSkills.includes("Docker"));
    assert.deepEqual(jd.languages, ["Python"]);
    assert.deepEqual(jd.locations, ["Bengaluru"], "country dropped when a city is given");
    assert.ok(!jd.requiredSkills.includes("SQL"), "PostgreSQL does not add SQL as its own requirement");
    assert.equal(jd.experienceYears, 5);
    assert.equal(jd.workMode, "Hybrid");
    assert.equal(jd.seniority, "Senior");
  });
});

describe("heuristicResumeAnalysis + mask", () => {
  const resume = "Priya Sharma\npriya@example.com | +91 98765 43210\n6 years building REST services with Django and Postgres on AWS.";
  it("marks found skills as matched with evidence and guesses the name", () => {
    const result = heuristicResumeAnalysis(
      [
        { name: "Python", type: "required" },
        { name: "PostgreSQL", type: "required" },
        { name: "Kafka", type: "preferred" },
      ],
      resume,
    );
    assert.equal(result.candidate, "Priya Sharma");
    assert.equal(result.candidateYears, 6);
    assert.equal(result.skills.find((s) => s.name === "PostgreSQL")?.status, "matched");
    assert.equal(result.skills.find((s) => s.name === "Kafka")?.status, "missing");
  });
  it("removes contact details and the name", () => {
    const masked = heuristicMask(resume, "CAND-ABC123", "Priya Sharma");
    assert.ok(!masked.includes("priya@example.com"));
    assert.ok(!masked.includes("98765"));
    assert.ok(!/Priya|Sharma/.test(masked));
    assert.ok(!masked.includes("CAND-ABC123 CAND-ABC123"));
    assert.ok(heuristicMask("Worked at X (2020-2025)", "C", null).includes("2020-2025"), "date ranges are not phone numbers");
  });
});
