/**
 * Creates (or updates the password of) a recruiter who can sign in.
 *   npm run user:create -- you@company.com "Your Name" "a-long-password"
 * Uses DATABASE_URL from the environment / .env. The first user creates the organization.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/password";

const [email, name, password] = process.argv.slice(2);
const orgName = process.env.ORG_NAME;
if (!email || !name || !password || password.length < 8) {
  console.error('Usage: npm run user:create -- <email> "<name>" "<password, 8+ characters>"');
  process.exit(1);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password!);
    const existing = await prisma.recruiter.findUnique({ where: { email: email!.toLowerCase() } });
    if (existing) {
      await prisma.recruiter.update({ where: { id: existing.id }, data: { passwordHash, name } });
      console.log(`Updated password for ${email}`);
    } else {
      const organization = orgName ? ((await prisma.organization.findFirst({ where: { name: orgName } })) ?? (await prisma.organization.create({ data: { name: orgName } }))) : ((await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })) ?? (await prisma.organization.create({ data: { name: "My organization" } })));
      const first = (await prisma.recruiter.count({ where: { organizationId: organization.id } })) === 0;
      await prisma.recruiter.create({ data: { email: email!.toLowerCase(), name: name!, passwordHash, organizationId: organization.id, role: first ? "admin" : "recruiter" } });
      console.log(`Created ${email} in "${organization.name}"`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
