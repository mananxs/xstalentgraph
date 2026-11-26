import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreCandidate } from "@/server/ai/heuristic";
import type { DiscoveryJobInput } from "@/server/sourcing/providers/search/types";
import { CutshortClient, CutshortError, parseHit } from "./client";
import { buildCutshortProfileText } from "./profile";
import { buildCutshortSearch, cutshortCity, skillGroup } from "./search";

const job: DiscoveryJobInput & { experienceYears: number } = {
  title: "Senior React Developer",
  requiredSkills: ["React", "TypeScript", "Node.js"],
  preferredSkills: ["AWS"],
  languages: ["TypeScript"],
  locations: ["Bangalore, India", "Navi Mumbai"],
  remoteAllowed: false,
  seniority: "Senior",
  experienceYears: 5,
};

describe("buildCutshortSearch", () => {
  const params = buildCutshortSearch(job);

  it("builds q, an inresume boolean with synonym groups, both experience bounds and Cutshort's city format", () => {
    assert.match(params.q ?? "", /^React Developer React TypeScript Node\.js/);
    assert.equal(params.inresume, '(react OR reactjs OR "react.js") AND typescript AND ("node.js" OR node OR nodejs)');
    assert.equal(params.minexp, 4);
    assert.equal(params.maxexp, 11);
    assert.equal(params.locations, "Bengaluru+%28Bangalore%29-Navi+Mumbai");
  });

  it("uses uppercase operators and never more than three skill groups", () => {
    assert.ok(!/ and | or /.test(params.inresume ?? ""));
    assert.ok((params.inresume ?? "").split(" AND ").length <= 3);
  });

  it("derives experience from seniority when the job has no years, and omits it otherwise", () => {
    const senior = buildCutshortSearch({ ...job, experienceYears: 0 });
    assert.deepEqual([senior.minexp, senior.maxexp], [4, 12]);
    const none = buildCutshortSearch({ ...job, experienceYears: 0, seniority: null, title: "React Developer" });
    assert.equal(none.minexp, undefined);
    assert.equal(none.maxexp, undefined);
  });

  it("omits locations for remote / country-only jobs and throws on an empty job", () => {
    assert.equal(buildCutshortSearch({ ...job, locations: ["Remote", "India"] }).locations, undefined);
    assert.throws(() => buildCutshortSearch({ ...job, title: "", requiredSkills: [], preferredSkills: [], languages: [] }));
  });

  it("formats single skills and cities", () => {
    assert.equal(skillGroup("Go"), "(go OR golang)");
    assert.equal(skillGroup("Figma"), "figma");
    assert.equal(cutshortCity("Bengaluru"), "Bengaluru+%28Bangalore%29");
    assert.equal(cutshortCity("Navi Mumbai"), "Navi+Mumbai");
  });
});

describe("CutshortClient", () => {
  const raw = {
    talentCardId: "abc123",
    experience: 6,
    currentLocation: "Bengaluru",
    currentCompany: "Freshworks",
    workHistory: ["Senior React Developer at Freshworks (2020 - Present)", "React Developer at Zoho (2017 - 2020)"],
    education: ["B.Tech, NIT"],
    profileSignals: { educationPedigree: { score: 3, level: "tier1plus", reason: "x" }, workQuality: { level: "high" } },
    redactedResumeText: "Led a team of 6 building React and TypeScript apps; reduced page load by 40%. Call 98765 01234.",
  };

  const fake = (handler: (url: URL, init: RequestInit) => Response) =>
    (async (url: string, init: RequestInit) => handler(new URL(url), init)) as unknown as typeof fetch;

  it("searches with bearer auth, both experience bounds and a capped page size", async () => {
    let seen: URL | null = null;
    const client = new CutshortClient({
      apiKey: "cs_live_K",
      fetchImpl: fake((url, init) => {
        seen = url;
        assert.equal((init.headers as Record<string, string>).Authorization, "Bearer cs_live_K");
        return Response.json({ results: [raw, { nope: true }], page: 1, pageSize: 20, totalCount: 847 });
      }),
    });
    const page = await client.search({ q: "react", inresume: "(react) AND (typescript)", minexp: 4, maxexp: 9, locations: "Bengaluru+%28Bangalore%29" }, 1, 50);
    assert.equal(page.hits.length, 1); // the hit without an id is dropped
    assert.equal(page.totalCount, 847);
    const params = (seen as unknown as URL).searchParams;
    assert.equal(params.get("pageSize"), "20");
    assert.equal(params.get("locations"), "Bengaluru+%28Bangalore%29"); // the API wants this literal value
    assert.equal(params.get("inresume"), "(react) AND (typescript)");
    assert.equal(params.get("minexp"), "4");
  });

  it("sends only one experience bound as none (Cutshort needs both)", async () => {
    let seen: URL | null = null;
    const client = new CutshortClient({ apiKey: "k", fetchImpl: fake((url) => ((seen = url), Response.json({ results: [] }))) });
    await client.search({ q: "x", minexp: 3 });
    assert.equal((seen as unknown as URL).searchParams.has("minexp"), false);
  });

  it("reads usage and contact details", async () => {
    const client = new CutshortClient({
      apiKey: "k",
      fetchImpl: fake((url) =>
        url.pathname.endsWith("/usage")
          ? Response.json({ apiUnlocks: { used: 3, limit: 10 }, searches: { used: 40, limit: 100 } })
          : Response.json({ talentCardId: "abc123", displayName: "Priya Sharma", email: "p@example.com", phone: "+919876501234", unlockedNow: true }),
      ),
    });
    assert.deepEqual(await client.usage(), { apiUnlocks: { used: 3, limit: 10 }, searches: { used: 40, limit: 100 } });
    assert.deepEqual(await client.candidate("abc123"), { displayName: "Priya Sharma", email: "p@example.com", phone: "+919876501234", unlockedNow: true });
  });

  it("surfaces Cutshort's error code, and flags unlock limits", async () => {
    const client = new CutshortClient({ apiKey: "k", fetchImpl: fake(() => new Response(JSON.stringify({ error_code: "api_unlock_limit_reached" }), { status: 429 })) });
    await assert.rejects(client.candidate("x"), (error: unknown) => error instanceof CutshortError && error.isUnlockLimit && error.status === 429);
    const bad = new CutshortClient({ apiKey: "k", fetchImpl: fake(() => new Response(JSON.stringify({ error_code: "invalid_api_key" }), { status: 401 })) });
    await assert.rejects(bad.usage(), /invalid_api_key/);
  });

  it("requires a key", () => {
    assert.throws(() => new CutshortClient({ apiKey: "" }), /CUTSHORT_API_KEY/);
  });

  it("parses a hit defensively", () => {
    const hit = parseHit(raw);
    assert.equal(hit?.talentCardId, "abc123");
    assert.deepEqual(hit?.signals, ["education pedigree: tier1plus", "work quality: high"]);
    assert.equal(parseHit(null), null);
    assert.equal(parseHit({}), null);
  });
});

describe("buildCutshortProfileText", () => {
  const hit = parseHit({
    talentCardId: "abc123",
    experience: 6,
    currentLocation: "Bengaluru",
    currentCompany: "Freshworks",
    workHistory: ["Senior React Developer at Freshworks (2020 - Present)", "React Developer at Zoho (2017 - 2020)"],
    education: ["B.Tech, NIT"],
    redactedResumeText: "Led a team of 6 building React, TypeScript and Node.js apps on a SaaS platform; reduced page load by 40%. Call 98765 01234 or a@b.com.",
  })!;
  const text = buildCutshortProfileText(hit);

  it("keeps work history on separate dated lines and removes contact data", () => {
    assert.match(text, /^Headline: Senior React Developer at Freshworks/);
    assert.match(text, /Experience: 6 years/);
    assert.match(text, /\nWork: React Developer at Zoho \(2017 - 2020\)/);
    assert.doesNotMatch(text, /98765|a@b\.com/);
  });

  it("scores far better than a one-line snippet, because it has real evidence", () => {
    const result = scoreCandidate({ ...job, description: "SaaS product company.", experienceYears: 5 }, text, { now: new Date("2026-11-19") });
    assert.ok(result.score >= 70, `scored ${result.score}`);
    assert.deepEqual(result.missingSkills, ["AWS"]);
  });
});
