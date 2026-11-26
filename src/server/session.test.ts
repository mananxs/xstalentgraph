import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPassword, verifyPassword } from "./password";
import { signSession, verifySession } from "./session";

const S = "unit-test-secret-0123456789";
describe("session cookie", () => {
  it("round-trips", async () => assert.equal(await verifySession(await signSession("rid-1", S), S), "rid-1"));
  it("rejects a tampered cookie", async () => {
    const t = await signSession("rid-1", S);
    const [b, s] = t.split(".");
    const forged = `${Buffer.from(JSON.stringify({ rid: "rid-2", exp: Date.now() + 1e9 })).toString("base64url")}.${s}`;
    assert.equal(await verifySession(forged, S), null);
    assert.equal(await verifySession(`${b}.AAAA`, S), null);
  });
  it("rejects another secret, an expired cookie and garbage", async () => {
    const t = await signSession("rid-1", S);
    assert.equal(await verifySession(t, "different-secret-0123456789"), null);
    assert.equal(await verifySession(await signSession("rid-1", S, 0), S), null);
    for (const junk of ["", "x", "a.b", null, undefined]) assert.equal(await verifySession(junk as string, S), null);
  });
});
describe("password", () => {
  it("accepts the right password only", async () => {
    const h = await hashPassword("correct horse");
    assert.ok(await verifyPassword("correct horse", h));
    assert.equal(await verifyPassword("wrong", h), false);
    assert.equal(await verifyPassword("anything", null), false);
  });
});
