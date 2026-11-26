/**
 * Phase 2 check: runs the real GitHub ingestion for the seeded job and prints a few profiles.
 * Usage: npm run github:smoke            (10 profiles)
 *        npm run github:smoke -- 25      (25 profiles)
 */
import { prisma } from "@/server/db";
import { GitHubClient } from "@/server/github/client";
import { buildSearchQueries } from "@/server/github/searchQueries";
import { findJobInOrganization } from "@/server/repositories/jobRepository";
import { findRecruiterByEmail } from "@/server/repositories/recruiterRepository";
import { getDecryptedToken } from "@/server/repositories/tokenRepository";

const SEED_JOB_ID = "00000000-0000-4000-8000-000000000003";

async function main(): Promise<void> {
  const maxProfiles = Number(process.argv[2] ?? 10);
  const email = process.env.DEV_RECRUITER_EMAIL ?? "recruiter@talentgraph.dev";

  const recruiter = await findRecruiterByEmail(email);
  if (!recruiter) throw new Error(`No recruiter ${email}. Run: npx prisma db seed`);

  const token = await getDecryptedToken(recruiter.id, "github");
  if (!token) throw new Error("No GitHub token stored. Run: npx prisma db seed");

  const job = await findJobInOrganization(SEED_JOB_ID, recruiter.organizationId);
  if (!job) throw new Error("Seeded job not found. Run: npx prisma db seed");

  const queries = buildSearchQueries(job);
  console.log("\nSearch queries:");
  for (const query of queries) console.log("  ", query);

  const client = new GitHubClient({ token });
  const profiles = await client.searchProfiles(queries, maxProfiles);

  console.log(`\nFetched ${profiles.length} unique profiles. First ${Math.min(5, profiles.length)}:\n`);
  for (const profile of profiles.slice(0, 5)) {
    const languages = Object.entries(profile.topLanguages)
      .slice(0, 3)
      .map(([name, share]) => `${name} ${Math.round(share * 100)}%`)
      .join(", ");
    console.log(`@${profile.login}  (${profile.name ?? "no name"})`);
    console.log(`  location: ${profile.location ?? "-"}   account age: ${profile.yearsActive} years`);
    console.log(`  languages: ${languages || "-"}`);
    console.log(`  topics: ${profile.topics.slice(0, 6).join(", ") || "-"}`);
    console.log(`  bio: ${profile.bio?.slice(0, 100) ?? "-"}\n`);
  }

  const limit = client.getRateLimit();
  if (limit) {
    console.log(`Rate limit: ${limit.remaining} requests left, resets at ${new Date(limit.resetAtMs).toISOString()}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
