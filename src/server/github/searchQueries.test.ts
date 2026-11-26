import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSearchQueries } from "./searchQueries";

describe("buildSearchQueries", () => {
  it("builds one search for the seeded job", () => {
    const queries = buildSearchQueries({ languages: ["Python"], locations: ["Berlin"] });
    assert.deepEqual(queries, ['location:Berlin language:Python repos:>=3']);
  });

  it("runs one search per location (GitHub ANDs repeated location qualifiers)", () => {
    const queries = buildSearchQueries({ languages: ["Python"], locations: ["Berlin", "Munich"] });
    assert.equal(queries.length, 2);
    assert.ok(queries[0]?.includes("location:Berlin"));
    assert.ok(queries[1]?.includes("location:Munich"));
    for (const query of queries) assert.equal(query.match(/location:/g)?.length, 1);
  });

  it("quotes values with spaces and strips quote characters", () => {
    const queries = buildSearchQueries({ languages: ["Jupyter Notebook"], locations: ['San "Francisco"'] });
    assert.equal(queries[0], 'location:"San Francisco" language:"Jupyter Notebook" repos:>=3');
  });

  it("works without a location (remote job) and dedupes case-insensitively", () => {
    const queries = buildSearchQueries({ languages: ["Python", "python", "Go"], locations: [] });
    assert.deepEqual(queries, ["language:Python repos:>=3", "language:Go repos:>=3"]);
  });

  it("never sorts by followers and never searches bios or topics", () => {
    const [query] = buildSearchQueries({ languages: ["Python"], locations: ["Berlin"] });
    assert.ok(!/sort:|followers:|topic:|in:bio/.test(query ?? ""));
  });

  it("caps the number of searches and keeps every location covered first", () => {
    const queries = buildSearchQueries(
      { languages: ["A", "B", "C"], locations: ["X", "Y", "Z"] },
      { maxQueries: 4 },
    );
    assert.equal(queries.length, 4);
  });

  it("refuses a job with no language and no location", () => {
    assert.throws(() => buildSearchQueries({ languages: [], locations: [" "] }), /at least one/);
  });
});
