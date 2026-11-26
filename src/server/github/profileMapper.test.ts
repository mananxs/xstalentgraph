import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapUserNode } from "./profileMapper";
import type { UserNode } from "./schemas";

const baseNode: UserNode = {
  databaseId: 42,
  login: "alice",
  name: "Alice",
  bio: "Backend dev",
  location: "Berlin, Germany",
  createdAt: "2016-01-01T00:00:00Z",
  avatarUrl: "https://avatars.example/alice.png",
  url: "https://github.com/alice",
  repositories: {
    nodes: [
      {
        languages: { edges: [{ size: 600, node: { name: "Python" } }, { size: 200, node: { name: "Shell" } }] },
        repositoryTopics: { nodes: [{ topic: { name: "fastapi" } }, { topic: { name: "api" } }] },
      },
      {
        languages: { edges: [{ size: 200, node: { name: "Python" } }] },
        repositoryTopics: { nodes: [{ topic: { name: "fastapi" } }] },
      },
      null,
      { languages: null, repositoryTopics: null },
    ],
  },
};

describe("mapUserNode", () => {
  it("aggregates languages by bytes into shares", () => {
    const profile = mapUserNode(baseNode, new Date("2026-01-01T00:00:00Z"));
    assert.deepEqual(profile?.topLanguages, { Python: 0.8, Shell: 0.2 });
  });

  it("ranks topics by how many repositories use them", () => {
    const profile = mapUserNode(baseNode);
    assert.deepEqual(profile?.topics, ["fastapi", "api"]);
  });

  it("computes years active with one decimal and keeps ids as bigint", () => {
    const profile = mapUserNode(baseNode, new Date("2026-01-01T00:00:00Z"));
    assert.equal(profile?.yearsActive, 10);
    assert.equal(profile?.githubId, 42n);
  });

  it("returns null when GitHub gives no database id", () => {
    assert.equal(mapUserNode({ ...baseNode, databaseId: null }), null);
  });

  it("handles a user with no repositories", () => {
    const profile = mapUserNode({ ...baseNode, repositories: { nodes: null } });
    assert.deepEqual(profile?.topLanguages, {});
    assert.deepEqual(profile?.topics, []);
  });
});
