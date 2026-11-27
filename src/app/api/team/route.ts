import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleRoute } from "@/server/api/http";
import { requireAdmin, requireRecruiter } from "@/server/auth";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";
import { isAllowedEmail, ROLES } from "@/server/access";
import { allowedDomain } from "@/server/google";

export const dynamic = "force-dynamic";

/** GET /api/team - members of the organization (everyone can see the list; only admins change it). */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const me = await requireRecruiter();
    const members = await prisma.recruiter.findMany({ where: { organizationId: me.organizationId }, orderBy: { createdAt: "asc" }, select: { id: true, email: true, name: true, role: true, createdAt: true, lastLoginAt: true, googleSub: true, passwordHash: true, _count: { select: { apiKeys: true, jobs: true } } } });
    // What each HR has been doing, so a manager can see everyone's workload at a glance (counts only; details are in Jobs / Pipeline).
    const [matches, beats] = await Promise.all([
      prisma.matchScore.groupBy({ by: ["jobId"], where: { job: { organizationId: me.organizationId } }, _count: { _all: true } }),
      prisma.extensionConnection.findMany({ where: { organizationId: me.organizationId }, select: { recruiterId: true, lastSeenAt: true } }),
    ]);
    const jobOwner = new Map((await prisma.jobDescription.findMany({ where: { organizationId: me.organizationId }, select: { id: true, createdById: true } })).map((j) => [j.id, j.createdById]));
    const candidates = new Map<string, number>();
    for (const g of matches) { const o = jobOwner.get(g.jobId); if (o) candidates.set(o, (candidates.get(o) ?? 0) + g._count._all); }
    const seen = new Map<string, number>();
    for (const b of beats) seen.set(b.recruiterId, Math.max(seen.get(b.recruiterId) ?? 0, b.lastSeenAt.getTime()));
    return NextResponse.json({ me: { id: me.id, role: me.role }, members: members.map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role, createdAt: m.createdAt, canSignIn: Boolean(m.passwordHash) || Boolean(m.googleSub), google: Boolean(m.googleSub), lastLoginAt: m.lastLoginAt, extensionKeys: m._count.apiKeys, jobs: m._count.jobs, candidates: candidates.get(m.id) ?? 0, extensionOnline: Date.now() - (seen.get(m.id) ?? 0) < 45_000 })) });
  });
}

const create = z.object({ email: z.string().trim().email().max(200), name: z.string().trim().min(1).max(100).optional(), password: z.string().min(8).max(200).optional(), role: z.enum(ROLES).default("recruiter") });

/** POST /api/team - an admin adds a member by e-mail + role (e.g. a manager). No password needed: they sign in with Google. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const admin = await requireAdmin();
    const input = create.parse(await request.json().catch(() => ({})));
    const email = input.email.toLowerCase();
    if (await prisma.recruiter.findUnique({ where: { email } })) throw new ApiError(409, "That email already has an account.");
    if (!input.password && !isAllowedEmail(email)) throw new ApiError(400, `Without a password the member signs in with Google, so the address must end in @${allowedDomain()}.`);
    const member = await prisma.recruiter.create({ data: { organizationId: admin.organizationId, email, name: input.name ?? email.split("@")[0]!, role: input.role, passwordHash: input.password ? await hashPassword(input.password) : null }, select: { id: true, email: true, name: true, role: true } });
    return NextResponse.json({ member }, { status: 201 });
  });
}

const patch = z.object({ memberId: z.string().uuid(), role: z.enum(ROLES).optional(), password: z.string().min(8).max(200).optional() });

/** PATCH /api/team { memberId, role?, password? } - change a role or reset a password. The last admin cannot be demoted. */
export async function PATCH(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const admin = await requireAdmin();
    const input = patch.parse(await request.json().catch(() => ({})));
    const member = await prisma.recruiter.findFirst({ where: { id: input.memberId, organizationId: admin.organizationId } });
    if (!member) throw new ApiError(404, "Member not found.");
    if (input.role && member.role === "admin" && input.role !== "admin" && (await prisma.recruiter.count({ where: { organizationId: admin.organizationId, role: "admin" } })) <= 1) throw new ApiError(409, "There must be at least one admin.");
    await prisma.recruiter.update({ where: { id: member.id }, data: { role: input.role ?? undefined, passwordHash: input.password ? await hashPassword(input.password) : undefined } });
    return NextResponse.json({ ok: true });
  });
}
