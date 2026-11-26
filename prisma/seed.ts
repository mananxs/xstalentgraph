import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/server/crypto/tokens";

const prisma = new PrismaClient();

// Fixed ids make the seed safe to run many times (it updates instead of duplicating).
const SEED_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const SEED_RECRUITER_ID = "00000000-0000-4000-8000-000000000002";
const SEED_JOB_ID = "00000000-0000-4000-8000-000000000003";

async function main(): Promise<void> {
  const githubPat = process.env.GITHUB_PAT;
  if (!githubPat) {
    throw new Error("GITHUB_PAT is missing. Add it to .env (the seed stores it encrypted).");
  }

  // Check the token now, so a dead one fails here with a clear message instead of in the middle of a run.
  const check = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${githubPat}`, "User-Agent": "talentgraph" },
  }).catch(() => null);
  if (check?.status === 401) {
    throw new Error(
      "GitHub rejected GITHUB_PAT (401 Bad credentials). Create a new classic token with no scopes at " +
        "https://github.com/settings/tokens, paste it into .env, and run `npx prisma db seed` again.",
    );
  }
  if (check === null) console.warn("Could not reach GitHub to check GITHUB_PAT; storing it anyway.");

  const recruiterEmail = process.env.DEV_RECRUITER_EMAIL ?? "recruiter@talentgraph.dev";

  const organization = await prisma.organization.upsert({
    where: { id: SEED_ORGANIZATION_ID },
    update: {},
    create: { id: SEED_ORGANIZATION_ID, name: "Acme Talent" },
  });

  const recruiter = await prisma.recruiter.upsert({
    where: { email: recruiterEmail },
    update: {},
    create: {
      id: SEED_RECRUITER_ID,
      email: recruiterEmail,
      name: "Dev Recruiter",
      organizationId: organization.id,
    },
  });

  const encryptedToken = encryptSecret(githubPat);
  await prisma.oAuthToken.upsert({
    where: { recruiterId_provider: { recruiterId: recruiter.id, provider: "github" } },
    update: { encryptedToken },
    create: { recruiterId: recruiter.id, provider: "github", encryptedToken },
  });

  const jobData = {
    organizationId: organization.id,
    createdById: recruiter.id,
    title: "Senior Python backend engineer",
    description:
      "We are hiring a senior backend engineer in Berlin to build and scale our API platform. " +
      "You will design REST services with FastAPI, model data with SQLAlchemy, and work closely " +
      "with product and data teams. Experience running services in production is expected.",
    requiredSkills: ["Python", "FastAPI", "SQLAlchemy"],
    preferredSkills: ["PostgreSQL", "Docker", "Alembic"],
    languages: ["Python"],
    locations: ["Berlin"],
    remoteAllowed: false,
  };

  const job = await prisma.jobDescription.upsert({
    where: { id: SEED_JOB_ID },
    update: jobData,
    create: { id: SEED_JOB_ID, ...jobData },
  });

  console.log("Seed complete.");
  console.log(`  Organization: ${organization.name} (${organization.id})`);
  console.log(`  Recruiter:    ${recruiter.email} (${recruiter.id})`);
  console.log(`  Job ID:       ${job.id}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
