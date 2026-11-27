import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { canSeeAll, type Viewer } from "@/server/access";

/** Resumes are found inside the caller's scope: a bare organization id (trusted internal use) or a viewer (HRs see only resumes of their own jobs). */
type Scope = string | Viewer;
const scoped = (scope: Scope) => (typeof scope === "string" ? { organizationId: scope } : canSeeAll(scope) ? { organizationId: scope.organizationId } : { organizationId: scope.organizationId, job: { createdById: scope.id } });
import type { ResumeDto, ResumeSkillDto } from "@/lib/types";

const resumeSelect = {
  id: true,
  jobId: true,
  fileName: true,
  fileType: true,
  name: true,
  summary: true,
  candidateYears: true,
  requiredYears: true,
  skills: true,
  score: true,
  reqHit: true,
  reqTotal: true,
  scoredBy: true,
  shortlisted: true,
  maskStatus: true,
  maskError: true,
  createdAt: true,
} satisfies Prisma.ResumeCandidateSelect;

type ResumeRow = Prisma.ResumeCandidateGetPayload<{ select: typeof resumeSelect }>;

const TITLES = /^(mr|mrs|ms|miss|mx|dr|prof|er)\.?$/i;

/** Short, stable, anonymous code, e.g. CAND-3F9A1C. */
export function resumeCode(id: string): string {
  return `CAND-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/** Candidates are shown by FIRST NAME only (never the surname); no name -> their code. */
export function resumeLabel(row: { id: string; name: string | null }): string {
  const first = (row.name ?? "").trim().split(/\s+/).find((word) => word && !TITLES.test(word));
  return first || resumeCode(row.id);
}

function toSkills(value: Prisma.JsonValue): ResumeSkillDto[] {
  return Array.isArray(value) ? (value as unknown as ResumeSkillDto[]) : [];
}

export function toResumeDto(row: ResumeRow): ResumeDto {
  return {
    id: row.id,
    jobId: row.jobId,
    code: resumeCode(row.id),
    fileName: row.fileName,
    fileType: row.fileType,
    name: row.name,
    label: resumeLabel(row),
    summary: row.summary,
    candidateYears: row.candidateYears,
    requiredYears: row.requiredYears,
    skills: toSkills(row.skills),
    score: row.score,
    reqHit: row.reqHit,
    reqTotal: row.reqTotal,
    scoredBy: row.scoredBy === "heuristic" ? "quick" : "ai",
    model: row.scoredBy,
    shortlisted: row.shortlisted,
    maskStatus: (["none", "masked", "failed"].includes(row.maskStatus) ? row.maskStatus : "none") as ResumeDto["maskStatus"],
    maskError: row.maskError,
    createdAt: row.createdAt.toISOString(),
  };
}

const matchedCount = (row: ResumeRow) => toSkills(row.skills).filter((skill) => skill.status === "matched").length;

/** Ranking: score, then required skills covered, then total matched (same as CandidateMatch). */
export async function listResumes(jobId: string, organizationId: string): Promise<ResumeDto[]> {
  const rows = await prisma.resumeCandidate.findMany({ where: { jobId, organizationId }, select: resumeSelect, take: 1000 });
  rows.sort((a, b) => b.score - a.score || b.reqHit - a.reqHit || matchedCount(b) - matchedCount(a));
  return rows.map(toResumeDto);
}

export async function createResume(data: Prisma.ResumeCandidateUncheckedCreateInput): Promise<ResumeDto> {
  return toResumeDto(await prisma.resumeCandidate.create({ data, select: resumeSelect }));
}

export async function findResume(id: string, scope: Scope) {
  return prisma.resumeCandidate.findFirst({
    where: { id, ...scoped(scope) },
    select: { ...resumeSelect, resumeText: true, maskedText: true, fileData: true },
  });
}

export async function updateResume(id: string, scope: Scope, data: Prisma.ResumeCandidateUpdateManyMutationInput): Promise<ResumeDto | null> {
  const result = await prisma.resumeCandidate.updateMany({ where: { id, ...scoped(scope) }, data });
  if (result.count === 0) return null;
  const row = await prisma.resumeCandidate.findFirst({ where: { id, ...scoped(scope) }, select: resumeSelect });
  return row ? toResumeDto(row) : null;
}

export async function deleteResume(id: string, scope: Scope): Promise<boolean> {
  const result = await prisma.resumeCandidate.deleteMany({ where: { id, ...scoped(scope) } });
  return result.count > 0;
}

export async function listShortlistedResumes(scope: Scope) {
  const rows = await prisma.resumeCandidate.findMany({
    where: { ...scoped(scope), shortlisted: true },
    select: { ...resumeSelect, job: { select: { title: true } } },
    orderBy: [{ score: "desc" }],
    take: 500,
  });
  return rows.map((row) => ({ ...toResumeDto(row), jobTitle: row.job.title }));
}
