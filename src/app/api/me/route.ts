import { NextResponse } from "next/server";
import { handleRoute } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

/** GET /api/me - who is signed in, plus whether they have set up their own AI key yet (drives the first-login prompt). */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const me = await requireRecruiter();
    const [row, keys] = await Promise.all([
      prisma.recruiter.findUnique({ where: { id: me.id }, select: { avatarUrl: true } }),
      prisma.aiCredential.count({ where: { recruiterId: me.id } }),
    ]);
    return NextResponse.json({ id: me.id, name: me.name, email: me.email, role: me.role, avatarUrl: row?.avatarUrl ?? null, hasAiKey: keys > 0 });
  });
}
