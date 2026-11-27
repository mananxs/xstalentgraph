import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleRoute } from "@/server/api/http";
import { requireAdmin, requireRecruiter } from "@/server/auth";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";

export const dynamic = "force-dynamic";

const ROLES = ["admin", "recruiter", "viewer"] as const;

/** GET /api/team - members of the organization (everyone can see the list; only admins change it). */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const me = await requireRecruiter();
    const members = await prisma.recruiter.findMany({ where: { organizationId: me.organizationId }, orderBy: { createdAt: "asc" }, select: { id: true, email: true, name: true, role: true, createdAt: true, passwordHash: true, _count: { select: { apiKeys: true } } } });
    return NextResponse.json({ me: { id: me.id, role: me.role }, members: members.map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role, createdAt: m.createdAt, canSignIn: Boolean(m.passwordHash), extensionKeys: m._count.apiKeys })) });
  });
}

const create = z.object({ email: z.string().trim().email().max(200), name: z.string().trim().min(1).max(100), password: z.string().min(8).max(200), role: z.enum(ROLES).default("recruiter") });

/** POST /api/team - an admin adds a member (email + password + role). */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const admin = await requireAdmin();
    const input = create.parse(await request.json().catch(() => ({})));
    const email = input.email.toLowerCase();
    if (await prisma.recruiter.findUnique({ where: { email } })) throw new ApiError(409, "That email already has an account.");
    const member = await prisma.recruiter.create({ data: { organizationId: admin.organizationId, email, name: input.name, role: input.role, passwordHash: await hashPassword(input.password) }, select: { id: true, email: true, name: true, role: true } });
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
