import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApifySerpProvider, parseLinkedInTitle, parseSerpItems } from "./apifySerp";
import type { DiscoveryJobInput, SerpCandidate } from "./types";
import { buildMicroQueries, INDIAN_TECH_HUBS } from "./xrayQueries";

const job: DiscoveryJobInput = {
  title: "Senior React Developer",
  requiredSkills: ["React", "Node.js", "TypeScript"],
  preferredSkills: ["AWS"],
  languages: ["TypeScript"],
  locations: ["Pune, India"],
  remoteAllowed: false,
  seniority: "Senior",
};

describe("buildMicroQueries", () => {
  const queries = buildMicroQueries(job);

  it("uses the X-Ray format with exclusions", () => {
    for (const query of queries) {
      assert.match(query, /^site:linkedin\.com\/in /);
      assert.ok(query.endsWith('-intitle:"profiles" -inurl:"dir"'), query);
    }
    assert.equal(
      queries[0],
      'site:linkedin.com/in "React" "Senior React Developer" "Pune" -intitle:"profiles" -inurl:"dir"',
    );
  });

  it("generates dozens of distinct queries across every hub, with a cap", () => {
    assert.ok(queries.length >= 30, `only ${queries.length}`);
    assert.equal(new Set(queries.map((q) => q.toLowerCase())).size, queries.length);
    assert.ok(queries.length <= 60);
    assert.equal(buildMicroQueries(job, { maxQueries: 5 }).length, 5);
    for (const hub of INDIAN_TECH_HUBS) assert.ok(queries.some((q) => q.includes(`"${hub.aliases[0]}"`)), hub.city);
  });

  it("is ordered round-robin so a short list still covers every hub", () => {
    const firstSeven = buildMicroQueries(job, { maxQueries: 7 });
    for (const hub of INDIAN_TECH_HUBS) assert.ok(firstSeven.some((q) => q.includes(`"${hub.aliases[0]}"`)), hub.city);
  });

  it("covers Delhi NCR with all its names and expands title spellings", () => {
    assert.ok(queries.some((q) => q.includes('("Delhi" OR "Gurugram" OR "Gurgaon" OR "Noida")')));
    const [first] = buildMicroQueries({ ...job, title: "Full Stack Developer", seniority: null, locations: [] });
    assert.match(first ?? "", /"Full Stack Developer"/);
    assert.ok(buildMicroQueries({ ...job, title: "Full Stack Developer", seniority: null }).some((q) => q.includes('"Fullstack Developer"')));
  });

  it("slices a job city outside the standard hubs as its own slice, first", () => {
    const [first] = buildMicroQueries({ ...job, locations: ["Kochi, India"] });
    assert.ok(first?.includes('"Kochi"'));
  });

  it("works with a title only, and throws on an empty job", () => {
    assert.ok(buildMicroQueries({ ...job, requiredSkills: [], preferredSkills: [], languages: [] }).length > 0);
    assert.throws(() => buildMicroQueries({ ...job, title: "", requiredSkills: [], preferredSkills: [], languages: [] }));
  });
});

describe("parseLinkedInTitle", () => {
  it("splits name and headline", () => {
    assert.deepEqual(parseLinkedInTitle("Rahul Sharma - Senior Java Developer - Infosys | LinkedIn"), {
      name: "Rahul Sharma",
      headline: "Senior Java Developer - Infosys",
      location: null,
    });
  });
  it("reads a location-only title", () => {
    assert.deepEqual(parseLinkedInTitle("Priya N - Pune, Maharashtra, India | Professional Profile | LinkedIn"), {
      name: "Priya N",
      headline: null,
      location: "Pune, Maharashtra, India",
    });
  });
  it("does not mistake a page title for a name", () => {
    assert.equal(parseLinkedInTitle("100+ \"React Developer\" profiles | LinkedIn").name, null);
  });
});

describe("parseSerpItems", () => {
  const payload = [
    {
      searchQuery: { term: "q1" },
      organicResults: [
        { title: "Asha Rao - React Developer - Flipkart | LinkedIn", url: "https://in.linkedin.com/in/Asha-Rao-1?trk=x", description: "Bengaluru · React Developer · Flipkart. Call 98765 01234. Location: Bengaluru · 500+ connections on LinkedIn." },
        { title: "Acme | LinkedIn", url: "https://www.linkedin.com/company/acme", description: "x" },
        { title: "React developers", url: "https://www.linkedin.com/pub/dir/React/Developer", description: "x" },
        { title: "Not linkedin", url: "https://example.com/in/nope", description: "x" },
      ],
    },
    { searchQuery: { term: "q2" }, organicResults: [{ title: "Asha Rao | LinkedIn", url: "https://www.linkedin.com/in/asha-rao-1/", description: "Mobile +91 87001 23456" }] },
  ];

  it("keeps /in/ profiles, canonicalises, merges duplicates and keeps the raw snippet", () => {
    const candidates = parseSerpItems(payload);
    assert.equal(candidates.length, 1);
    const [asha] = candidates as [SerpCandidate];
    assert.equal(asha.linkedinUrl, "https://www.linkedin.com/in/asha-rao-1");
    assert.equal(asha.name, "Asha Rao");
    assert.equal(asha.headline, "React Developer - Flipkart");
    assert.equal(asha.location, "Bengaluru");
    assert.equal(asha.query, "q1");
    assert.match(asha.snippet, /98765 01234/);
    assert.match(asha.snippet, /87001 23456/); // the duplicate's snippet is merged
  });

  it("returns [] for junk", () => {
    assert.deepEqual(parseSerpItems({}), []);
    assert.deepEqual(parseSerpItems(null), []);
    assert.deepEqual(parseSerpItems("nope"), []);
  });
});

describe("ApifySerpProvider", () => {
  const item = (id: string, term: string) => ({
    searchQuery: { term },
    organicResults: [{ title: `Person ${id} - Dev | LinkedIn`, url: `https://www.linkedin.com/in/${id}`, description: "snippet" }],
  });

  it("calls the actor with bearer auth and newline-joined queries, in batches", async () => {
    const calls: Array<{ url: string; auth: string; body: { queries: string; countryCode: string } }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { queries: string; countryCode: string };
      calls.push({ url, auth: (init.headers as Record<string, string>).Authorization ?? "", body });
      return Response.json(body.queries.split("\n").map((term, index) => item(`p${calls.length}-${index}`, term)));
    }) as unknown as typeof fetch;

    const result = await new ApifySerpProvider({ apiToken: "TOKEN", fetchImpl, queriesPerRun: 4, maxQueries: 12 }).discover(job, 1000);
    assert.equal(calls.length, 3);
    assert.ok(calls[0]!.url.includes("/acts/apify~google-search-scraper/run-sync-get-dataset-items"));
    assert.equal(calls[0]!.auth, "Bearer TOKEN");
    assert.equal(calls[0]!.body.countryCode, "in");
    assert.equal(calls[0]!.body.queries.split("\n").length, 4);
    assert.equal(result.candidates.length, 12);
    assert.equal(result.queriesTried.length, 12);
  });

  it("stops paying for queries as soon as enough candidates are found, and streams each run", async () => {
    let calls = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls++;
      const queries = (JSON.parse(String(init.body)) as { queries: string }).queries.split("\n");
      return Response.json(queries.map((term, index) => item(`r${calls}-${index}`, term)));
    }) as unknown as typeof fetch;

    const streamed: number[] = [];
    const result = await new ApifySerpProvider({ apiToken: "t", fetchImpl, queriesPerRun: 5 }).discover(job, 7, async (page) => {
      streamed.push(page.length);
    });
    assert.equal(calls, 2);
    assert.equal(result.candidates.length, 7);
    assert.deepEqual(streamed, [5, 2]);
  });

  it("retries once on a 5xx, then reports the error when everything fails", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response("down", { status: 503 });
    }) as unknown as typeof fetch;
    await assert.rejects(
      new ApifySerpProvider({ apiToken: "t", fetchImpl, sleep: async () => {}, maxQueries: 2 }).discover(job, 5),
      /503/,
    );
    assert.equal(calls, 2);
  });

  it("does not retry a 401", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response("no", { status: 401 });
    }) as unknown as typeof fetch;
    await assert.rejects(new ApifySerpProvider({ apiToken: "t", fetchImpl, maxQueries: 2 }).discover(job, 5), /401/);
    assert.equal(calls, 1);
  });

  it("requires a token", () => {
    assert.throws(() => new ApifySerpProvider({ apiToken: "" }), /APIFY_API_TOKEN/);
  });
});
