import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

const query = z.object({ q: z.string().max(100).optional(), source: z.enum(["naukri", "linkedin", "github", "cutshort", "direct"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) });

/** GET /api/talent-pool - every candidate of the organization, across all jobs and sources (one row per person). */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const recruiter = await requireRecruiter();
    const { q, source, limit, offset } = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const where = {
      matchScores: { some: { job: { organizationId: recruiter.organizationId } } },
      ...(source ? { sources: { has: source } } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { headline: { contains: q, mode: "insensitive" as const } }, { location: { contains: q, mode: "insensitive" as const } }, { skills: { has: q } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.candidate.count({ where }),
      prisma.candidate.findMany({
        where, take: limit, skip: offset, orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, login: true, headline: true, location: true, experienceYears: true, primarySource: true, sources: true, skills: true, _count: { select: { resumes: true } }, matchScores: { where: { job: { organizationId: recruiter.organizationId } }, select: { id: true, score: true, tier: true, stage: true, job: { select: { id: true, title: true } } } } },
      }),
    ]);
    return NextResponse.json({
      total,
      candidates: rows.map((c) => ({ id: c.id, name: c.name ?? c.login, headline: c.headline, location: c.location, experienceYears: c.experienceYears, primarySource: c.primarySource, sources: c.sources, skills: c.skills.slice(0, 8), hasResume: c._count.resumes > 0, jobs: c.matchScores.map((m) => ({ matchId: m.id, jobId: m.job.id, jobTitle: m.job.title, score: m.score, tier: m.tier, stage: m.stage })) })),
    });
  });
}
