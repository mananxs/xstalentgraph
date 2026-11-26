import type { UserNode } from "./schemas";

/** Public GitHub metadata for one developer. Nothing here comes from code or commits. */
export interface CandidateProfile {
  githubId: bigint;
  login: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  avatarUrl: string;
  profileUrl: string;
  githubCreatedAt: Date;
  /** Years since the GitHub account was created, one decimal. */
  yearsActive: number;
  /** Share of code bytes per language, e.g. { Python: 0.62 }. Sums to about 1. */
  topLanguages: Record<string, number>;
  /** Most frequent repository topics, most common first. */
  topics: string[];
}

const MAX_LANGUAGES = 8;
const MAX_TOPICS = 15;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Sorts [name, number] pairs by number (high first), then by name for stable output. */
function byValueDescThenName(a: [string, number], b: [string, number]): number {
  return b[1] - a[1] || a[0].localeCompare(b[0]);
}

/**
 * Converts one GraphQL user node into a CandidateProfile.
 * Languages are summed by bytes across the user's repositories and turned into shares.
 * Topics are ranked by how many repositories use them.
 * @returns null when GitHub did not give a numeric id (we cannot dedupe such a user).
 */
export function mapUserNode(node: UserNode, now: Date = new Date()): CandidateProfile | null {
  if (node.databaseId === null) return null;

  const bytesByLanguage = new Map<string, number>();
  const reposByTopic = new Map<string, number>();

  for (const repository of node.repositories.nodes ?? []) {
    if (!repository) continue;

    for (const edge of repository.languages?.edges ?? []) {
      if (!edge) continue;
      const name = edge.node.name;
      bytesByLanguage.set(name, (bytesByLanguage.get(name) ?? 0) + edge.size);
    }

    for (const topicNode of repository.repositoryTopics?.nodes ?? []) {
      if (!topicNode) continue;
      const name = topicNode.topic.name;
      reposByTopic.set(name, (reposByTopic.get(name) ?? 0) + 1);
    }
  }

  const totalBytes = [...bytesByLanguage.values()].reduce((sum, bytes) => sum + bytes, 0);
  const topLanguages: Record<string, number> = {};
  if (totalBytes > 0) {
    const ranked = [...bytesByLanguage.entries()].sort(byValueDescThenName).slice(0, MAX_LANGUAGES);
    for (const [name, bytes] of ranked) {
      topLanguages[name] = Math.round((bytes / totalBytes) * 1000) / 1000;
    }
  }

  const topics = [...reposByTopic.entries()]
    .sort(byValueDescThenName)
    .slice(0, MAX_TOPICS)
    .map(([name]) => name);

  const githubCreatedAt = new Date(node.createdAt);
  const years = Math.max(0, (now.getTime() - githubCreatedAt.getTime()) / MS_PER_YEAR);

  return {
    githubId: BigInt(node.databaseId),
    login: node.login,
    name: node.name,
    bio: node.bio,
    location: node.location,
    avatarUrl: node.avatarUrl,
    profileUrl: node.url,
    githubCreatedAt,
    yearsActive: Math.round(years * 10) / 10,
    topLanguages,
    topics,
  };
}
