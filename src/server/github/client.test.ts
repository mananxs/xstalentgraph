import assert from "node:assert/strict";
import { describe, it } from "node:test";
import pino from "pino";
import { GitHubClient } from "./client";
import { GitHubApiError, GitHubAuthError, GitHubRateLimitError } from "./errors";

const silentLogger = pino({ level: "silent" });
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function userNode(id: number, login: string) {
  return {
    databaseId: id,
    login,
    name: null,
    bio: null,
    location: "Berlin",
    createdAt: "2020-01-01T00:00:00Z",
    avatarUrl: `https://avatars.example/${login}`,
    url: `https://github.com/${login}`,
    repositories: { nodes: [] },
  };
}

function searchBody(nodes: unknown[], page = { hasNextPage: false, endCursor: null as string | null }) {
  return { data: { search: { userCount: nodes.length, pageInfo: page, nodes } } };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** Builds a client whose fetch returns the given responses in order, and whose sleep is recorded. */
function setup(responses: Array<Response | Error>, extra: Partial<ConstructorParameters<typeof GitHubClient>[0]> = {}) {
  const requests: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const sleeps: number[] = [];
  let call = 0;

  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> });
    const next = responses[call++];
    if (!next) throw new Error("test ran out of fake responses");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;

  const client = new GitHubClient({
    token: "test-token",
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => NOW,
    random: () => 0.5,
    logger: silentLogger,
    ...extra,
  });
  return { client, requests, sleeps };
}

describe("GitHubClient", () => {
  it("never asks GitHub for the email field", async () => {
    const { client, requests } = setup([jsonResponse(searchBody([userNode(1, "a")]))]);
    await client.searchProfiles(["language:Python"], 5);
    const query = requests[0]?.query ?? "";
    assert.ok(!/\bemail\b/i.test(query));
  });

  it("collects profiles and follows the cursor across pages", async () => {
    const { client, requests } = setup([
      jsonResponse(searchBody([userNode(1, "a")], { hasNextPage: true, endCursor: "C1" })),
      jsonResponse(searchBody([userNode(2, "b")])),
    ]);
    const profiles = await client.searchProfiles(["language:Python"], 10);
    assert.deepEqual(profiles.map((p) => p.login), ["a", "b"]);
    assert.equal(requests[1]?.variables.after, "C1");
  });

  it("de-duplicates by GitHub id across searches", async () => {
    const { client } = setup([
      jsonResponse(searchBody([userNode(1, "a"), userNode(2, "b")])),
      jsonResponse(searchBody([userNode(2, "b"), userNode(3, "c")])),
    ]);
    const profiles = await client.searchProfiles(["location:Berlin", "location:Munich"], 10);
    assert.deepEqual(profiles.map((p) => p.login), ["a", "b", "c"]);
  });

  it("stops at the profile cap", async () => {
    const { client, requests } = setup([
      jsonResponse(searchBody([userNode(1, "a"), userNode(2, "b"), userNode(3, "c")], { hasNextPage: true, endCursor: "C" })),
    ]);
    const profiles = await client.searchProfiles(["language:Python"], 2);
    assert.equal(profiles.length, 2);
    assert.equal(requests.length, 1);
  });

  it("retries a 502 with backoff and then succeeds", async () => {
    const { client, sleeps } = setup([
      new Response("bad gateway", { status: 502 }),
      jsonResponse(searchBody([userNode(1, "a")])),
    ]);
    const profiles = await client.searchProfiles(["language:Python"], 5);
    assert.equal(profiles.length, 1);
    assert.equal(sleeps.length, 1);
    assert.ok((sleeps[0] ?? 0) >= 500 && (sleeps[0] ?? 0) <= 1000);
  });

  it("shrinks the page size when GitHub keeps timing out with 502", async () => {
    const { client, requests } = setup(
      [
        new Response("bad gateway", { status: 502 }),
        new Response("bad gateway", { status: 502 }),
        jsonResponse(searchBody([userNode(1, "a")])),
      ],
      { pageSize: 20 },
    );
    const profiles = await client.searchProfiles(["language:Python"], 5);
    assert.equal(profiles.length, 1);
    assert.equal(requests.length, 3);
    assert.equal(requests[0]?.variables.first, 20);
    assert.equal(requests[1]?.variables.first, 20); // one plain retry first
    assert.equal(requests[2]?.variables.first, 10); // then half the users
  });

  it("shrinks the page when GraphQL answers with a timeout error and no data", async () => {
    const { client, requests } = setup(
      [
        jsonResponse({ data: null, errors: [{ message: "Something went wrong while executing your query." }] }),
        jsonResponse(searchBody([userNode(1, "a")])),
      ],
      { pageSize: 8 },
    );
    const profiles = await client.searchProfiles(["language:Python"], 5);
    assert.equal(profiles.length, 1);
    assert.equal(requests[1]?.variables.first, 4);
  });

  it("gives up on a query that still times out with one user per page", async () => {
    const bad = () => new Response("bad gateway", { status: 502 });
    const { client } = setup([bad(), bad(), bad(), bad()], { pageSize: 2 });
    await assert.rejects(() => client.searchProfiles(["language:Python"], 5), GitHubApiError);
  });

  it("retries after a network error", async () => {
    const { client, sleeps } = setup([new TypeError("fetch failed"), jsonResponse(searchBody([userNode(1, "a")]))]);
    const profiles = await client.searchProfiles(["language:Python"], 5);
    assert.equal(profiles.length, 1);
    assert.equal(sleeps.length, 1);
  });

  it("fails clearly on 401 and does not retry", async () => {
    const { client, requests } = setup([jsonResponse({ message: "Bad credentials" }, { status: 401 })]);
    await assert.rejects(() => client.searchProfiles(["language:Python"], 5), GitHubAuthError);
    assert.equal(requests.length, 1);
  });

  it("honours Retry-After on a secondary rate limit (403)", async () => {
    const { client, sleeps } = setup([
      jsonResponse({ message: "You have exceeded a secondary rate limit" }, { status: 403, headers: { "retry-after": "7" } }),
      jsonResponse(searchBody([userNode(1, "a")])),
    ]);
    await client.searchProfiles(["language:Python"], 5);
    assert.deepEqual(sleeps, [7000]);
  });

  it("waits at least a minute for a secondary limit without Retry-After", async () => {
    const { client, sleeps } = setup([
      jsonResponse({ message: "secondary rate limit" }, { status: 403 }),
      jsonResponse(searchBody([userNode(1, "a")])),
    ]);
    await client.searchProfiles(["language:Python"], 5);
    assert.ok((sleeps[0] ?? 0) >= 60_000);
  });

  it("does not retry a 403 that is not a rate limit", async () => {
    const { client, requests } = setup([jsonResponse({ message: "Resource protected by SAML enforcement" }, { status: 403 })]);
    await assert.rejects(() => client.searchProfiles(["language:Python"], 5), GitHubApiError);
    assert.equal(requests.length, 1);
  });

  it("sleeps until reset when remaining quota is low, before the next request", async () => {
    const resetSeconds = Math.floor(NOW / 1000) + 30;
    const { client, sleeps } = setup(
      [
        jsonResponse(searchBody([userNode(1, "a")], { hasNextPage: true, endCursor: "C" }), {
          headers: { "x-ratelimit-remaining": "3", "x-ratelimit-reset": String(resetSeconds) },
        }),
        jsonResponse(searchBody([userNode(2, "b")])),
      ],
      { lowRateLimitThreshold: 10 },
    );
    const profiles = await client.searchProfiles(["language:Python"], 10);
    assert.equal(profiles.length, 2);
    assert.deepEqual(sleeps, [31_000]);
  });

  it("handles a GraphQL RATE_LIMITED error inside an HTTP 200", async () => {
    const resetSeconds = Math.floor(NOW / 1000) + 10;
    const { client, sleeps } = setup([
      jsonResponse(
        { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] },
        { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSeconds) } },
      ),
      jsonResponse(searchBody([userNode(1, "a")])),
    ]);
    const profiles = await client.searchProfiles(["language:Python"], 5);
    assert.equal(profiles.length, 1);
    assert.deepEqual(sleeps, [11_000]);
  });

  it("gives up with a rate-limit error when the wait is too long", async () => {
    const resetSeconds = Math.floor(NOW / 1000) + 3 * 3600;
    const { client } = setup(
      [jsonResponse({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSeconds) } })],
      { maxRateLimitWaitMs: 60 * 60 * 1000 },
    );
    await assert.rejects(() => client.searchProfiles(["language:Python"], 5), GitHubRateLimitError);
  });

  it("throws the last error when every search fails, after retries are used up", async () => {
    const { client, requests } = setup(
      Array.from({ length: 3 }, () => new Response("down", { status: 503 })),
      { maxRetries: 2 },
    );
    await assert.rejects(() => client.searchProfiles(["language:Python"], 5), GitHubApiError);
    assert.equal(requests.length, 3);
  });

  it("skips one malformed user node without failing the run", async () => {
    const { client } = setup([jsonResponse(searchBody([{ login: 123 }, userNode(1, "a")]))]);
    const profiles = await client.searchProfiles(["language:Python"], 5);
    assert.deepEqual(profiles.map((p) => p.login), ["a"]);
  });

  it("calls onNewProfiles after each page with only the new users", async () => {
    const { client } = setup([
      jsonResponse(searchBody([userNode(1, "a"), userNode(2, "b")], { hasNextPage: true, endCursor: "C" })),
      jsonResponse(searchBody([userNode(2, "b"), userNode(3, "c")])),
    ]);
    const pages: string[][] = [];
    await client.searchProfiles(["language:Python"], 10, {
      onNewProfiles: async (profiles) => {
        pages.push(profiles.map((p) => p.login));
      },
    });
    assert.deepEqual(pages, [["a", "b"], ["c"]]);
  });
});
