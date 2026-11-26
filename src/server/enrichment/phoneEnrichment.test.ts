import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApolloPhoneProvider } from "./apollo";
import { enrichPhone, needsPaidEnrichment, PlaceholderPhoneEnrichment, type PhoneEnrichmentProvider } from "./phoneEnrichment";

const request = { candidateId: "c1", linkedinUrl: "https://www.linkedin.com/in/a", name: null, headline: null };

describe("needsPaidEnrichment (the credit guard)", () => {
  const none = { regexPhone: null, storedPhone: null };

  it("is true at 75 and above without any phone", () => {
    assert.equal(needsPaidEnrichment({ score: 75, ...none }), true);
    assert.equal(needsPaidEnrichment({ score: 100, ...none }), true);
  });
  it("never spends credits below 75%", () => {
    assert.equal(needsPaidEnrichment({ score: 74, ...none }), false);
    assert.equal(needsPaidEnrichment({ score: 0, ...none }), false);
  });
  it("honours a custom threshold", () => {
    assert.equal(needsPaidEnrichment({ score: 80, ...none, minScore: 85 }), false);
    assert.equal(needsPaidEnrichment({ score: 85, ...none, minScore: 85 }), true);
  });
  it("skips candidates that already have a phone (snippet regex or stored)", () => {
    assert.equal(needsPaidEnrichment({ score: 95, regexPhone: "+919876501234", storedPhone: null }), false);
    assert.equal(needsPaidEnrichment({ score: 95, regexPhone: null, storedPhone: "+919876501234" }), false);
  });
});

describe("enrichPhone", () => {
  it("the placeholder makes no lookup and finds nothing", async () => {
    const result = await enrichPhone(request, new PlaceholderPhoneEnrichment());
    assert.equal(result.phone, null);
    assert.equal(result.status, "skipped");
  });

  it("keeps only an Indian mobile returned by a vendor", async () => {
    const vendor = (phone: string): PhoneEnrichmentProvider => ({
      name: "fake",
      findPhone: async () => ({ phone, provider: "fake", status: "found" }),
    });
    assert.equal((await enrichPhone(request, vendor("+91 98765 01234"))).phone, "+919876501234");
    const foreign = await enrichPhone(request, vendor("+44 20 7946 0958"));
    assert.equal(foreign.phone, null);
    assert.equal(foreign.status, "not_found");
  });

  it("turns a vendor crash into an error result", async () => {
    const broken: PhoneEnrichmentProvider = { name: "broken", findPhone: async () => { throw new Error("boom"); } };
    const result = await enrichPhone(request, broken);
    assert.equal(result.status, "error");
    assert.equal(result.phone, null);
  });
});

describe("ApolloPhoneProvider", () => {
  const fake = (status: number, body: unknown) =>
    (async (_url: string, init: RequestInit) => {
      assert.equal((init.headers as Record<string, string>)["x-api-key"], "KEY");
      assert.deepEqual(JSON.parse(String(init.body)), { linkedin_url: request.linkedinUrl });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;

  it("prefers a mobile number and validates it as Indian", async () => {
    const provider = new ApolloPhoneProvider("KEY", fake(200, { person: { phone_numbers: [
      { sanitized_number: "+441234567890", type: "work_hq" },
      { sanitized_number: "+919876501234", type: "mobile" },
    ] } }));
    assert.equal((await enrichPhone(request, provider)).phone, "+919876501234");
  });

  it("returns not_found when Apollo has no phone, and an error on 401/429", async () => {
    assert.equal((await enrichPhone(request, new ApolloPhoneProvider("KEY", fake(200, { person: { phone_numbers: [] } })))).status, "not_found");
    const bad = await enrichPhone(request, new ApolloPhoneProvider("KEY", fake(429, { error: "rate" })));
    assert.equal(bad.status, "error");
    assert.match(bad.detail ?? "", /429/);
  });
});
