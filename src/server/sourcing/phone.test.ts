import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractIndianMobile, extractIndianMobiles, stripIndianMobiles } from "./phone";

describe("extractIndianMobiles", () => {
  const same = (text: string) => assert.deepEqual(extractIndianMobiles(text), ["+919876501234"], text);

  it("reads every common way of writing the same mobile number", () => {
    for (const text of [
      "call 9876501234 now",
      "98765 01234",
      "98765-01234",
      "9876 501 234",
      "98 76 50 12 34",
      "+91 98765 01234",
      "+91-9876501234",
      "+91 9876501234",
      "(+91) 98765.01234",
      "(91) 9876501234",
      "919876501234",
      "09876501234",
      "0 98765 01234",
      "0091 9876501234",
      "Reach me: +919876501234.",
    ]) same(text);
  });

  it("finds several numbers, in order, without duplicates", () => {
    assert.deepEqual(extractIndianMobiles("98765 01234 / 8700123456 / +91 98765 01234"), ["+919876501234", "+918700123456"]);
  });

  it("rejects numbers that are not Indian mobiles", () => {
    for (const text of [
      "+44 7911 123456", // UK mobile
      "080 6123 4567", // Bengaluru landline
      "079-2345-6789", // Ahmedabad landline
      "022 2345 6789", // Mumbai landline
      "5 digits 12345",
      "2018 - 2021 · 3 yrs",
      "5 years 2020 2021 2022",
      "ref 12349876501234", // tail of a longer number
      "98765012345", // 11 digits
      "5876501234", // mobiles start with 6-9
      "9999999999",
      "9876543210",
    ]) assert.deepEqual(extractIndianMobiles(text), [], text);
  });

  it("never throws on junk", () => {
    assert.deepEqual(extractIndianMobiles(""), []);
    assert.deepEqual(extractIndianMobiles(null), []);
    assert.deepEqual(extractIndianMobiles(undefined), []);
  });

  it("extractIndianMobile returns the first or null", () => {
    assert.equal(extractIndianMobile("Mobile: 8700123456, email a@b.com"), "+918700123456");
    assert.equal(extractIndianMobile("no number here"), null);
  });

  it("stripIndianMobiles removes numbers but keeps landlines and dates", () => {
    assert.equal(stripIndianMobiles("call +91 98765 01234 today").replace(/\s+/g, " "), "call today");
    assert.match(stripIndianMobiles("office 080 6123 4567, 2019 - 2021"), /080 6123 4567.*2019 - 2021/);
  });
});
