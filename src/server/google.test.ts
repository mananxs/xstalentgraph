import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkProfile, GoogleAuthError, profileFromCode, redirectUri } from "./google";

const req = new Request("https://xs.example.com/api/auth/google/callback?code=1");
const good = { sub: "123", email: "Asha@XSAssociates.com", email_verified: true, name: "Asha Rao", picture: "https://x/p.png", hd: "xsassociates.com" };

describe("google sign-in rules", () => {
  it("accepts a verified company account and normalises the e-mail", () => {
    const p = checkProfile(good);
    assert.equal(p.email, "asha@xsassociates.com");
    assert.equal(p.name, "Asha Rao");
  });
  it("rejects other domains, unverified e-mails and a wrong hosted domain", () => {
    for (const bad of [{ ...good, email: "asha@gmail.com", hd: undefined }, { ...good, email_verified: false }, { ...good, hd: "other.com" }, { ...good, email: "asha@xsassociates.com.evil.io", hd: undefined }]) {
      assert.throws(() => checkProfile(bad), GoogleAuthError);
    }
    assert.throws(() => checkProfile({ email: "a@xsassociates.com", email_verified: true }), /profile/);
  });
  it("builds the callback from the request origin, or APP_URL", () => {
    assert.equal(redirectUri(req), "https://xs.example.com/api/auth/google/callback");
    process.env.APP_URL = "https://hunt.xsassociates.com/";
    assert.equal(redirectUri(req), "https://hunt.xsassociates.com/api/auth/google/callback");
    delete process.env.APP_URL;
  });
  it("exchanges the code and applies the same rules (fake Google)", async () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const seen: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return String(url).includes("oauth2.googleapis.com") ? new Response(JSON.stringify({ access_token: "tok" })) : new Response(JSON.stringify(good));
    }) as typeof fetch;
    const p = await profileFromCode(req, "code123", fake);
    assert.equal(p.sub, "123");
    assert.equal(seen.length, 2);
    const denied = (async (url: string | URL | Request) => (String(url).includes("oauth2") ? new Response("{}", { status: 400 }) : new Response("{}"))) as typeof fetch;
    await assert.rejects(profileFromCode(req, "x", denied), /did not accept/);
  });
});
