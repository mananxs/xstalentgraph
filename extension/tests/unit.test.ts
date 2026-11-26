import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resultMatchesCard } from "../src/shared/util";

const card = "Santhosh Kumar\n7y 0m  ₹ 12 Lacs  Hyderabad\nCurrent DevOps Engineer at Aptly Tech";

describe("resultMatchesCard", () => {
  it("accepts a result about the same person", () => assert.ok(resultMatchesCard({ fullName: "Santhosh Kumar", currentCompany: "Aptly Tech" }, card)));
  it("rejects another candidate's result (the reported bug)", () => assert.equal(resultMatchesCard({ fullName: "Pooja Jaiswar", currentCompany: "Capgemini" }, card), false));
  it("rejects right name but wrong company", () => assert.equal(resultMatchesCard({ fullName: "Santhosh Kumar", currentCompany: "Capgemini" }, card), false));
  it("cannot judge a result with no extracted block or no name, so accepts it", () => {
    assert.ok(resultMatchesCard(undefined, card));
    assert.ok(resultMatchesCard({ fullName: "" }, card));
  });
  it("tolerates a surname-only difference of case/punctuation", () => assert.ok(resultMatchesCard({ fullName: "santhosh  kumar." }, card)));
});
