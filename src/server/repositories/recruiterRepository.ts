import { prisma } from "@/server/db";

/** The small recruiter shape the API needs for authorization checks. */
export interface RecruiterContext {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  role: string;
}

/**
 * Finds a recruiter by email (one query).
 * Used by DEV_AUTH to load the seeded recruiter.
 */
export async function findRecruiterByEmail(email: string): Promise<RecruiterContext | null> {
  return prisma.recruiter.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, organizationId: true, role: true },
  });
}

export async function findRecruiterById(id: string): Promise<RecruiterContext | null> {
  return prisma.recruiter.findUnique({ where: { id }, select: { id: true, email: true, name: true, organizationId: true, role: true } });
}

/** For login only: includes the password hash. Never return this object to the browser. */
export async function findRecruiterForLogin(email: string) {
  return prisma.recruiter.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, email: true, name: true, passwordHash: true } });
}

/** OPEN_ACCESS mode: the shared recruiter, created (with an organization) the first time it is needed. */
export async function ensureOpenRecruiter(email: string): Promise<RecruiterContext> {
  const found = await findRecruiterByEmail(email);
  if (found) return found;
  return prisma.$transaction(async (tx) => {
    const organization = (await tx.organization.findFirst({ orderBy: { createdAt: "asc" } })) ?? (await tx.organization.create({ data: { name: "My organization" } }));
    return tx.recruiter.create({ data: { email, name: "Open access", organizationId: organization.id }, select: { id: true, email: true, name: true, organizationId: true, role: true } });
  });
}
