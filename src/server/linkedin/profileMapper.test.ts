import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLinkedInProfileText } from "@/server/ai/profileText";
import { heuristicMatch } from "@/server/ai/heuristic";
import { mapBrightDataProfile, normaliseLinkedInUrls } from "./profileMapper";

const now = new Date("2026-01-01T00:00:00Z");
const record = {
  id: "Jane-Doe-123",
  url: "https://www.linkedin.com/in/jane-doe-123/?trk=x",
  name: "Jane Doe",
  position: "Senior Python Engineer",
  city: "Berlin",
  country_code: "DE",
  about: "Backend dev. Reach me: Jane@Example.com or +49 151 2345 6789. Site: https://jane.dev",
  skills: ["Python", { name: "FastAPI" }, "python"],
  contact_info: { emails: ["jane.work@corp.io"], websites: [{ url: "https://github.com/jane" }] },
  experience: [
    { title: "Engineer", start_date: "2018-01", end_date: "2021-01" },
    { title: "Senior Engineer", start_date: "2020-01", end_date: "Present" },
  ],
};

describe("mapBrightDataProfile", () => {
  const profile = mapBrightDataProfile(record, now);

  it("maps core fields", () => {
    assert.equal(profile?.linkedinId, "jane-doe-123");
    assert.equal(profile?.fullName, "Jane Doe");
    assert.equal(profile?.headline, "Senior Python Engineer");
    assert.equal(profile?.location, "Berlin");
    assert.deepEqual(profile?.skills, ["Python", "FastAPI"]);
  });

  it("merges overlapping jobs when computing experience years", () => {
    assert.equal(profile?.experienceYears, 8); // 2018-01 .. 2026-01
  });

  it("extracts contact data from fields and free text", () => {
    assert.deepEqual(profile?.emails, ["jane.work@corp.io", "jane@example.com"]);
    assert.deepEqual(profile?.phoneNumbers, ["+4915123456789"]);
    assert.equal(profile?.personalWebsite, "https://jane.dev");
    assert.deepEqual(profile?.otherLinks, ["https://github.com/jane"]);
    assert.equal(profile?.profileUrl, "https://www.linkedin.com/in/jane-doe-123/?trk=x");
  });

  it("drops Bright Data error rows", () => {
    assert.equal(mapBrightDataProfile({ error: "dead page", input: { url: "x" } }), null);
    assert.equal(mapBrightDataProfile("nope"), null);
  });
});

describe("LinkedIn text for the AI", () => {
  it("contains skills but no contact data or name", () => {
    const profile = mapBrightDataProfile(record, now);
    assert.ok(profile);
    const text = buildLinkedInProfileText(profile);
    assert.match(text, /Skills: Python, FastAPI/);
    assert.doesNotMatch(text, /Doe|corp\.io|example\.com|\+49|jane\.dev|151/);
  });

  it("is scored by the shared heuristic scorer", () => {
    const profile = mapBrightDataProfile(record, now);
    assert.ok(profile);
    const result = heuristicMatch(
      { title: "Backend", description: "", requiredSkills: ["Python", "Go"], preferredSkills: [], languages: ["Python"], locations: ["Berlin"], remoteAllowed: false },
      buildLinkedInProfileText(profile),
    );
    assert.deepEqual(result.matchedSkills, ["Python"]);
    assert.deepEqual(result.missingSkills, ["Go"]);
    assert.ok(result.score > 30 && result.score <= 75, `half of the must-haves should land mid-range, got ${result.score}`);
  });
});

describe("normaliseLinkedInUrls", () => {
  it("normalises and de-duplicates profile URLs", () => {
    assert.deepEqual(normaliseLinkedInUrls(["https://linkedin.com/in/A/", "https://www.linkedin.com/in/a?x=1", "https://example.com"]), [
      "https://www.linkedin.com/in/a",
    ]);
  });
});
