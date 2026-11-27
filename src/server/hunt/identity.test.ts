import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findIdentity, normPhone, normUrl, type KnownCandidate } from "./identity";

const known: KnownCandidate[] = [
  { id: "a", name: "Santhosh Kumar", emails: ["s@x.com"], phones: ["+91 98765 43210"], profileUrl: "https://resdex.naukri.com/v3/profile?id=11", company: "Aptly Tech", expYears: 7 },
  { id: "b", name: "Pooja Jaiswar", company: "Capgemini", expYears: 6 },
];

describe("findIdentity", () => {
  it("matches on e-mail, phone, profile url", () => {
    assert.deepEqual(findIdentity(known, { name: "X", emails: ["S@X.com"] }), { id: "a", reason: "email" });
    assert.deepEqual(findIdentity(known, { name: "X", phones: ["09876543210"] }), { id: "a", reason: "phone" });
    assert.deepEqual(findIdentity(known, { name: "X", profileUrl: "https://www.resdex.naukri.com/v3/profile/?id=11" }), { id: "a", reason: "profile_url" });
  });
  it("matches name + company + experience (within a year)", () => {
    assert.deepEqual(findIdentity(known, { name: "pooja jaiswar", company: "CAPGEMINI", expYears: 6.5 }), { id: "b", reason: "name_company_experience" });
  });
  it("NEVER merges on name alone, or on name with a different company/experience", () => {
    assert.equal(findIdentity(known, { name: "Pooja Jaiswar" }), null);
    assert.equal(findIdentity(known, { name: "Pooja Jaiswar", company: "Ola", expYears: 6 }), null);
    assert.equal(findIdentity(known, { name: "Pooja Jaiswar", company: "Capgemini", expYears: 12 }), null);
    assert.equal(findIdentity(known, { name: "Pooja Jaiswar", company: "Capgemini" }), null);
  });
  it("a single first name is not enough even with company and experience", () => assert.equal(findIdentity(known, { name: "Pooja", company: "Capgemini", expYears: 6 }), null));
  it("a generic site root URL identifies nobody", () => assert.equal(findIdentity(known, { name: "Z", profileUrl: "https://resdex.naukri.com/" }), null));
});
describe("normalizers", () => {
  it("phone", () => { assert.equal(normPhone("+91-98765-43210"), "9876543210"); assert.equal(normPhone("12345"), null); });
  it("url", () => { assert.equal(normUrl("https://x.com/"), null); assert.equal(normUrl("javascript:alert(1)"), null); });
});

import { normalizeSource } from "./queries";
describe("source normalisation", () => {
  it("never lets 'Naukri AI' be a source", () => {
    for (const raw of ["Naukri AI", "naukri-ai", "NAUKRI_AI", "naukri"]) assert.equal(normalizeSource(raw), "naukri");
    assert.equal(normalizeSource("LinkedIn"), "linkedin");
  });
});
