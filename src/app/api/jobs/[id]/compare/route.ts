import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleRoute } from "@/server/api/http";
import { uuidSchema, requireJobAccess } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { listCandidateRows } from "@/server/hunt/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const CERT = /\b(aws certified[\w ]*|azure (?:administrator|developer|solutions)[\w ]*|certified kubernetes[\w ]*|cka|ckad|pmp|scrum master|cissp|gcp (?:professional|associate)[\w ]*|terraform associate)\b/gi;

/** GET /api/jobs/:id/compare?ids=a,b,c  (2 to 5 matches). Missing data is reported as missing, never filled in. */
export async function GET(request: Request, context: Ctx): Promise<Response> {
  return handleRoute(async () => {
    const { recruiter, job } = await requireJobAccess((await context.params).id);
    const ids = z.array(uuidSchema).min(2, "Pick at least 2 candidates.").max(5, "Compare up to 5 candidates.").parse((new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean));
    const { rows } = await listCandidateRows({ viewer: recruiter, jobId: job.id, limit: 300 });
    const picked = ids.map((id) => rows.find((r) => r.matchId === id));
    if (picked.some((p) => !p)) throw new ApiError(404, "One of the candidates is not in this job.");
    const evals = await prisma.candidateEvaluation.findMany({ where: { jobId: job.id, candidateId: { in: picked.map((p) => p!.candidateId) } }, orderBy: { createdAt: "desc" } });
    const texts = await prisma.candidate.findMany({ where: { id: { in: picked.map((p) => p!.candidateId) } }, select: { id: true, profileText: true, resumeText: true, bio: true, skills: true } });
    const textOf = new Map(texts.map((t) => [t.id, t]));
    return NextResponse.json({
      job: { id: job.id, title: job.title },
      candidates: picked.map((p) => {
        const row = p!;
        const e = evals.find((x) => x.candidateId === row.candidateId);
        const t = textOf.get(row.candidateId);
        const certs = [...new Set(((t?.resumeText ?? "") + " " + (t?.profileText ?? "")).match(CERT)?.map((c) => c.trim()) ?? [])].slice(0, 6);
        return { ...row, dimensions: (e?.dimensions ?? {}) as Record<string, unknown>, skills: t?.skills ?? [], certifications: certs.length ? certs : null };
      }),
    });
  });
}
