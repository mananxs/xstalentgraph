import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canSeeAll, isAllowedEmail, jobWhere, taskWhere } from "./access";

const org = "11111111-1111-1111-1111-111111111111";
describe("access", () => {
  it("only admins and managers see every HR's work", () => {
    assert.equal(canSeeAll({ role: "admin" }), true);
    assert.equal(canSeeAll({ role: "manager" }), true);
    assert.equal(canSeeAll({ role: "recruiter" }), false);
    assert.equal(canSeeAll({ role: "viewer" }), false);
  });
  it("scopes jobs and tasks to the creator for everyone else", () => {
    assert.deepEqual(jobWhere({ id: "a", role: "recruiter", organizationId: org }), { organizationId: org, createdById: "a" });
    assert.deepEqual(jobWhere({ id: "m", role: "manager", organizationId: org }), { organizationId: org });
    assert.deepEqual(taskWhere({ id: "a", role: "viewer", organizationId: org }), { organizationId: org, createdById: "a" });
    assert.deepEqual(taskWhere({ id: "x", role: "admin", organizationId: org }), { organizationId: org });
  });
  it("accepts only the company domain, exactly", () => {
    assert.equal(isAllowedEmail("hr@xsassociates.com"), true);
    assert.equal(isAllowedEmail("HR@XSAssociates.com"), true);
    assert.equal(isAllowedEmail("hr@xsassociates.com.evil.io"), false);
    assert.equal(isAllowedEmail("hr@evil-xsassociates.com"), false);
    assert.equal(isAllowedEmail("xsassociates.com"), false);
    assert.equal(isAllowedEmail("hr@gmail.com"), false);
    assert.equal(isAllowedEmail("hr@other.com", "@other.com"), true);
  });
});
