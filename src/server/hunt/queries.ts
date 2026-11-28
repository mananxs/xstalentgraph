import { jobWhere as jobScope, type Viewer } from "@/server/access";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { SHORTLIST_STAGES, STAGES, TIER_LABEL, type Tier } from "./stages";

/** "Naukri AI" (and any naukri-* label) is an evaluation engine, never a source: it is always shown as plain "naukri". */
export const normalizeSource = (value: string): string => (/^naukri/i.test(value) ? "naukri" : value.toLowerCase());

export interface CandidateRow {
  matchId: string;
  candidateId: string;
  name: string | null;
  headline: string | null;
  experienceYears: number | null;
  location: string | null;
  ctc: string | null;
  noticePeriod: string | null;
  primarySource: string;
  sources: string[];
  avatarUrl: string | null;
  /** The score shown everywhere: the recruiter's override when there is one, otherwise the evaluation. */
  score: number | null;
  aiScore: number | null;
  tier: Tier | null;
  tierLabel: string | null;
  overridden: boolean;
  overrideReason: string | null;
  stage: string;
  shortlisted: boolean;
  rubricVersion: number | null;
  evidenceCoverage: number | null;
  strengths: string[];
  concerns: string[];
  missingInfo: string[];
  matchedSkills: string[];
  missingSkills: string[];
  hasResume: boolean;
  fullProfile: boolean;
  status: string;
  updatedAt: string;
}

export interface CandidateQuery {
  /** Who is asking (see access.ts). */
  viewer: Viewer;
  jobId?: string;
  source?: string;
  stage?: string;
  tier?: string;
  q?: string;
  sort?: "score" | "recent" | "name";
  limit?: number;
  offset?: number;
}

/** Every usable profile address of a person, one per source (LinkedIn, Naukri, GitHub, ...), http(s) only. Opened in a new tab by the UI. */
export function profileLinks(c: { primarySource: string; profileUrl: string | null; sourceRecords?: Array<{ source: string; profileUrl: string | null }> }): Array<{ source: string; url: string }> {
  const out: Array<{ source: string; url: string }> = [];
  const add = (source: string, url: string | null | undefined) => {
    const u = (url ?? "").trim();
    if (/^https?:\/\//i.test(u) && !out.some((x) => x.url === u)) out.push({ source: normalizeSource(source), url: u });
  };
  add(c.primarySource, c.profileUrl);
  for (const r of c.sourceRecords ?? []) add(r.source, r.profileUrl);
  return out;
}

export async function listCandidateRows(query: CandidateQuery): Promise<{ rows: CandidateRow[]; total: number }> {
  const where: Prisma.MatchScoreWhereInput = {
    job: { ...jobScope(query.viewer), ...(query.jobId ? { id: query.jobId } : {}) },
    ...(query.stage ? { stage: query.stage } : {}),
    ...(query.tier ? { OR: [{ overrideTier: query.tier }, { overrideTier: null, tier: query.tier }] } : {}),
    candidate: {
      ...(query.source ? { sources: { has: query.source } } : {}),
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { headline: { contains: query.q, mode: "insensitive" } }, { skills: { has: query.q } }, { location: { contains: query.q, mode: "insensitive" } }] } : {}),
    },
  };
  const orderBy: Prisma.MatchScoreOrderByWithRelationInput[] = query.sort === "recent" ? [{ updatedAt: "desc" }] : query.sort === "name" ? [{ candidate: { name: "asc" } }] : [{ overrideScore: { sort: "desc", nulls: "last" } }, { score: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }];
  const [total, rows] = await Promise.all([
    prisma.matchScore.count({ where }),
    prisma.matchScore.findMany({
      where,
      orderBy: query.sort === "score" || !query.sort ? [{ score: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }] : orderBy,
      take: Math.min(query.limit ?? 100, 300),
      skip: query.offset ?? 0,
      include: { candidate: { select: { profileUrl: true, sourceRecords: { select: { source: true, profileUrl: true }, take: 6 }, id: true, name: true, login: true, headline: true, experienceYears: true, location: true, ctc: true, noticePeriod: true, primarySource: true, sources: true, avatarUrl: true, fullProfile: true, resumeFileName: true, resumeText: true, _count: { select: { resumes: true } } } } },
    }),
  ]);
  const evalIds = rows.map((r) => r.latestEvaluationId).filter((id): id is string => Boolean(id));
  const evals = evalIds.length ? await prisma.candidateEvaluation.findMany({ where: { id: { in: evalIds } }, select: { id: true, evidenceCoverage: true, strengths: true, concerns: true, missingInfo: true } }) : [];
  const byId = new Map(evals.map((e) => [e.id, e]));
  const mapped: CandidateRow[] = rows.map((m) => {
    const e = m.latestEvaluationId ? byId.get(m.latestEvaluationId) : undefined;
    const tier = ((m.overrideTier ?? m.tier) as Tier | null) ?? null;
    return {
      matchId: m.id,
      candidateId: m.candidateId,
      name: m.candidate.name ?? m.candidate.login,
      headline: m.candidate.headline,
      experienceYears: m.candidate.experienceYears,
      location: m.candidate.location,
      ctc: m.candidate.ctc,
      noticePeriod: m.candidate.noticePeriod,
      primarySource: normalizeSource(m.candidate.primarySource),
      sources: [...new Set((m.candidate.sources.length ? m.candidate.sources : [m.candidate.primarySource]).map(normalizeSource))],
      avatarUrl: m.candidate.avatarUrl,
      links: profileLinks(m.candidate),
      score: m.overrideScore ?? m.score,
      aiScore: m.score,
      tier,
      tierLabel: tier ? TIER_LABEL[tier] ?? tier : null,
      overridden: m.overrideScore !== null || m.overrideTier !== null,
      overrideReason: m.overrideReason,
      stage: m.stage,
      shortlisted: m.shortlisted,
      rubricVersion: m.rubricVersion,
      evidenceCoverage: e?.evidenceCoverage ?? null,
      strengths: e?.strengths ?? [],
      concerns: e?.concerns ?? [],
      missingInfo: e?.missingInfo ?? [],
      matchedSkills: m.matchedSkills,
      missingSkills: m.missingSkills,
      hasResume: m.candidate._count.resumes > 0 || Boolean(m.candidate.resumeFileName || m.candidate.resumeText),
      fullProfile: m.candidate.fullProfile,
      status: m.status,
      updatedAt: m.updatedAt.toISOString(),
    };
  });
  return { rows: mapped, total };
}

export async function dashboardMetrics(viewer: Viewer) {
  const jobWhere = { job: jobScope(viewer) };
  const [totalCandidates, shortlisted, pending, strong] = await Promise.all([
    prisma.matchScore.groupBy({ by: ["candidateId"], where: jobWhere }).then((g) => g.length),
    prisma.matchScore.count({ where: { ...jobWhere, stage: { in: [...SHORTLIST_STAGES] } } }),
    prisma.matchScore.count({ where: { ...jobWhere, stage: { in: ["new", "sourced", "screening"] } } }),
    prisma.matchScore.count({ where: { ...jobWhere, OR: [{ overrideTier: "strong" }, { overrideTier: null, tier: "strong" }] } }),
  ]);
  return { totalCandidates, shortlisted, pendingReview: pending, strongMatches: strong };
}

export interface AnalyticsQuery {
  /** Who is asking: an HR sees only their own jobs, admins and managers see everyone's. */
  viewer: Viewer;
  from?: Date;
  to?: Date;
  jobId?: string;
  source?: string;
}

/** Real analytics straight from the pipeline tables. Nothing here is estimated: an empty database gives zeros. */
export async function analytics(q: AnalyticsQuery) {
  const createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
  const where: Prisma.MatchScoreWhereInput = { job: { ...jobScope(q.viewer), ...(q.jobId ? { id: q.jobId } : {}) }, ...(Object.keys(createdAt).length ? { createdAt } : {}), ...(q.source ? { candidate: { sources: { has: q.source } } } : {}) };
  const matches = await prisma.matchScore.findMany({ where, take: 20000, select: { id: true, stage: true, tier: true, overrideTier: true, createdAt: true, stageChangedAt: true, candidate: { select: { primarySource: true } } } });
  const ids = matches.map((m) => m.id);
  const events = ids.length
    ? await prisma.pipelineEvent.findMany({ where: { matchId: { in: ids }, kind: "stage" }, orderBy: { createdAt: "asc" }, select: { matchId: true, fromStage: true, toStage: true, createdAt: true } })
    : [];

  const byPlatform: Record<string, number> = {};
  const stageCounts: Record<string, number> = Object.fromEntries(STAGES.map((s) => [s, 0]));
  const quality: Record<string, number> = { strong: 0, potential: 0, weak: 0, provisional: 0, needs_info: 0, unscored: 0 };
  for (const m of matches) {
    byPlatform[m.candidate.primarySource] = (byPlatform[m.candidate.primarySource] ?? 0) + 1;
    stageCounts[m.stage] = (stageCounts[m.stage] ?? 0) + 1;
    const tier = m.overrideTier ?? m.tier;
    quality[tier ?? "unscored"] = (quality[tier ?? "unscored"] ?? 0) + 1;
  }

  // Highest stage each candidate has reached (events + current stage). "rejected" is an exit, not a step forward.
  const order = STAGES.filter((s) => s !== "rejected");
  const rank = (s: string) => order.indexOf(s as (typeof order)[number]);
  const reached = new Map<string, number>();
  for (const m of matches) reached.set(m.id, Math.max(rank(m.stage), 0));
  for (const e of events) if (e.matchId) reached.set(e.matchId, Math.max(reached.get(e.matchId) ?? 0, rank(e.toStage ?? "")));
  const funnel = order.map((stage, i) => ({ stage, count: [...reached.values()].filter((r) => r >= i).length }));

  // Average time in stage: each stage lasts until the next stage event (or now, for the current one).
  const durations: Record<string, number[]> = {};
  const lastByMatch = new Map<string, { stage: string; at: Date }>();
  for (const m of matches) lastByMatch.set(m.id, { stage: "new", at: m.createdAt });
  for (const e of events) {
    if (!e.matchId) continue;
    const prev = lastByMatch.get(e.matchId);
    if (prev) (durations[prev.stage] ??= []).push((e.createdAt.getTime() - prev.at.getTime()) / 86_400_000);
    lastByMatch.set(e.matchId, { stage: e.toStage ?? "new", at: e.createdAt });
  }
  const avgDaysInStage = Object.fromEntries(Object.entries(durations).map(([stage, list]) => [stage, Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10]));

  // Source-wise conversion: share of each source's candidates that reached shortlist / interview / offer / hired.
  const sources = [...new Set(matches.map((m) => m.candidate.primarySource))];
  const conversion = sources.map((source) => {
    const mine = matches.filter((m) => m.candidate.primarySource === source);
    const atLeast = (stage: string) => mine.filter((m) => (reached.get(m.id) ?? 0) >= rank(stage)).length;
    return { source, sourced: mine.length, shortlisted: atLeast("shortlisted"), interviewed: atLeast("interviewed"), offer: atLeast("offer"), hired: atLeast("hired"), shortlistRate: mine.length ? Math.round((atLeast("shortlisted") / mine.length) * 100) : 0, hireRate: mine.length ? Math.round((atLeast("hired") / mine.length) * 100) : 0 };
  });

  return {
    totalSourced: matches.length,
    byPlatform,
    shortlisted: matches.filter((m) => (SHORTLIST_STAGES as readonly string[]).includes(m.stage)).length,
    awaitingReview: matches.filter((m) => ["new", "sourced", "screening"].includes(m.stage)).length,
    stageCounts,
    avgDaysInStage,
    conversion,
    quality,
    funnel,
  };
}
