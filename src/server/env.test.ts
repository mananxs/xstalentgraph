import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEnv } from "./env";

describe("env flags forgive typos", () => {
  it("treats an unreadable value as the safe default instead of crashing the site", () => {
    process.env.DATABASE_URL = "x";
    process.env.DIRECT_URL = "x";
    process.env.TOKEN_ENCRYPTION_KEY = "x";
    process.env.OPEN_ACCESS = "FLASE";
    process.env.EMBEDDED_WORKER = "nope";
    process.env.ALLOW_PASSWORD_LOGIN = " FALSE ";
    const e = getEnv();
    assert.equal(e.OPEN_ACCESS, false);
    assert.equal(e.EMBEDDED_WORKER, true);
    assert.equal(e.ALLOW_PASSWORD_LOGIN, false);
  });
});
