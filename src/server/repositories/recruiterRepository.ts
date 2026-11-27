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

const list = (value: string | undefined) => (value ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);

/**
 * Finds or creates the recruiter for a verified Google profile.
 * - A member an admin already added by e-mail keeps the role they were given.
 * - Anyone else on the company domain is created as a "recruiter" in the organization (the first person ever becomes admin).
 * - ADMIN_EMAILS / MANAGER_EMAILS in the environment promote those addresses (never demote anyone).
 */
export async function signInWithGoogle(profile: { sub: string; email: string; name: string; picture: string | null }): Promise<RecruiterContext> {
  const admins = list(process.env.ADMIN_EMAILS);
  const managers = list(process.env.MANAGER_EMAILS);
  const listed = admins.includes(profile.email) ? "admin" : managers.includes(profile.email) ? "manager" : null;
  const select = { id: true, email: true, name: true, organizationId: true, role: true } as const;

  const existing = (await prisma.recruiter.findUnique({ where: { googleSub: profile.sub }, select })) ?? (await prisma.recruiter.findUnique({ where: { email: profile.email }, select }));
  if (existing) {
    const promote = listed && existing.role !== "admin" && !(listed === "manager" && existing.role === "manager") ? listed : null;
    return prisma.recruiter.update({ where: { id: existing.id }, data: { googleSub: profile.sub, avatarUrl: profile.picture, lastLoginAt: new Date(), ...(promote ? { role: promote } : {}) }, select });
  }
  return prisma.$transaction(async (tx) => {
    const organization = (await tx.organization.findFirst({ orderBy: { createdAt: "asc" } })) ?? (await tx.organization.create({ data: { name: "XS Associates" } }));
    const first = (await tx.recruiter.count({ where: { organizationId: organization.id } })) === 0;
    return tx.recruiter.create({ data: { organizationId: organization.id, email: profile.email, name: profile.name, googleSub: profile.sub, avatarUrl: profile.picture, lastLoginAt: new Date(), role: first ? "admin" : (listed ?? "recruiter") }, select });
  });
}
