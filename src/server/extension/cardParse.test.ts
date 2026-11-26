import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cardKey, parseCard, parseCtcLpa, parseExperience, parseNotice } from "./cardParse";

const resdex = `Santhosh Kumar
7y 0m
₹ 12 Lacs
Hyderabad
Current
DevOps Engineer at Aptly Tech
Previous
Software Engineer at EPAM Systems
Key skills
Sonarqube | Github | AWS DevOps | Kubernetes | Terraform`;

const test = `Priya Nair a
Java Developer at Acme — 6 Yrs 0 Months | 20 Lacs | Notice period: 15 days
Current location: Bengaluru / Pune. Preferred: Hyderabad
Key skills: Java, Spring Boot, Kubernetes`;

describe("parseCard", () => {
  it("reads a Resdex card layout", () => {
    const c = parseCard(resdex);
    assert.equal(c.fullName, "Santhosh Kumar");
    assert.equal(c.expYears, 7);
    assert.equal(c.currentCtcLpa, 12);
    assert.equal(c.currentRole, "DevOps Engineer");
    assert.equal(c.currentCompany, "Aptly Tech");
    assert.match(c.location, /Hyderabad/);
    assert.deepEqual(c.skills.slice(0, 3), ["Sonarqube", "Github", "AWS DevOps"]);
  });
  it("reads the inline layout", () => {
    const c = parseCard(test);
    assert.equal(c.fullName, "Priya Nair");
    assert.equal(c.currentCompany, "Acme");
    assert.equal(c.expYears, 6);
    assert.equal(c.noticeDays, 15);
    assert.equal(c.location, "Bengaluru");
  });
  it("two different cards never share a name", () => assert.notEqual(parseCard(resdex).fullName, parseCard(test).fullName));
});
describe("helpers", () => {
  it("experience", () => { assert.equal(parseExperience("7y 6m"), 7.5); assert.equal(parseExperience("no"), -1); });
  it("ctc", () => { assert.equal(parseCtcLpa("₹ 12 Lacs"), 12); assert.equal(parseCtcLpa("1.2 Cr"), 120); assert.equal(parseCtcLpa("₹ 0"), -1); });
  it("notice", () => { assert.equal(parseNotice("Notice period: 2 months").days, 60); assert.equal(parseNotice("hello").days, -1); });
  it("card key: profile url wins, text otherwise, stable", () => {
    assert.equal(cardKey("a", "https://x.com/p?id=1"), cardKey("b", "https://x.com/p?id=1"));
    assert.notEqual(cardKey("a", "https://x.com/p?id=1"), cardKey("a", "https://x.com/p?id=2"));
    assert.equal(cardKey("Hello   World"), cardKey("hello world"));
    assert.notEqual(cardKey(resdex), cardKey(test));
  });
});
