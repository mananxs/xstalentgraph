import { jobWhere as jobScope, type Viewer } from "@/server/access";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleRoute } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { requireRecruiter, requireWriter } from "@/server/auth";
import { prisma } from "@/server/db";
import { moveStage, recordEvent } from "@/server/hunt/store";
import { isShortlistedStage, STAGES } from "@/server/hunt/stages";
import { profileLinks } from "@/server/hunt/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ matchId: string }> };

async function loadMatch(id: string, viewer: Viewer) {
  const match = await prisma.matchScore.findFirst({ where: { id, job: jobScope(viewer) }, include: { candidate: { select: { id: true, name: true, headline: true, primarySource: true, sources: true, profileUrl: true, sourceRecords: { select: { source: true, profileUrl: true }, take: 6 } } }, job: { select: { id: true, title: true } } } });
  if (!match) throw new ApiError(404, "Candidate not found.");
  return match;
}

/** GET /api/matches/:id - everything behind a candidate card: per-criterion evaluation, history, notes, interviews, reminders, activity. */
export async function GET(_r: Request, context: Ctx): Promise<Response> {
  return handleRoute(async () => {
    const recruiter = await requireRecruiter();
    const match = await loadMatch(uuidSchema.parse((await context.params).matchId), recruiter);
    const [evaluation, history, notes, interviews, reminders, events] = await Promise.all([
      match.latestEvaluationId ? prisma.candidateEvaluation.findUnique({ where: { id: match.latestEvaluationId } }) : null,
      prisma.candidateEvaluation.findMany({ where: { jobId: match.jobId, candidateId: match.candidateId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, total: true, tier: true, rubricVersion: true, evidenceCoverage: true, engine: true, createdAt: true } }),
      prisma.candidateNote.findMany({ where: { matchId: match.id }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.interview.findMany({ where: { matchId: match.id }, orderBy: { scheduledAt: "desc" }, take: 20 }),
      prisma.reminder.findMany({ where: { matchId: match.id }, orderBy: { dueAt: "asc" }, take: 20 }),
      prisma.pipelineEvent.findMany({ where: { organizationId: recruiter.organizationId, OR: [{ matchId: match.id }, { candidateId: match.candidateId, kind: { in: ["resume_view", "resume_download"] } }] }, orderBy: { createdAt: "desc" }, take: 60 }),
    ]);
    return NextResponse.json({
      match: { id: match.id, stage: match.stage, rejectionReason: match.rejectionReason, shortlisted: match.shortlisted, aiScore: match.score, overrideScore: match.overrideScore, overrideTier: match.overrideTier, overrideReason: match.overrideReason, overrideAt: match.overrideAt, job: match.job, candidate: match.candidate },
      links: profileLinks(match.candidate),
      evaluation, history, notes, interviews, reminders, events,
    });
  });
}

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stage"), to: z.enum(STAGES), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("shortlist"), value: z.boolean() }),
  z.object({ action: z.literal("override"), score: z.number().int().min(0).max(100).optional(), tier: z.enum(["strong", "potential", "weak"]).optional(), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("clear_override") }),
  z.object({ action: z.literal("note"), body: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("interview"), scheduledAt: z.string().datetime(), mode: z.string().max(30).default("video"), interviewers: z.string().max(200).optional(), outcome: z.string().max(200).optional(), notes: z.string().max(2000).optional() }),
  z.object({ action: z.literal("reminder"), dueAt: z.string().datetime(), text: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("reminder_done"), reminderId: uuidSchema }),
]);

/** PATCH /api/matches/:id - stage moves, shortlist, recruiter override (with a reason), notes, interviews, reminders. All audited. */
export async function PATCH(request: Request, context: Ctx): Promise<Response> {
  return handleRoute(async () => {
    const recruiter = await requireWriter();
    const match = await loadMatch(uuidSchema.parse((await context.params).matchId), recruiter);
    const input = action.parse(await request.json().catch(() => ({})));
    const base = { organizationId: recruiter.organizationId, jobId: match.jobId, candidateId: match.candidateId, matchId: match.id, actorId: recruiter.id };

    switch (input.action) {
      case "stage": {
        try {
          const moved = await moveStage({ organizationId: recruiter.organizationId, matchId: match.id, to: input.to, actorId: recruiter.id, reason: input.reason });
          return NextResponse.json({ ok: true, ...moved });
        } catch (error) {
          throw new ApiError(400, (error as Error).message);
        }
      }
      case "shortlist": {
        const to = input.value ? "shortlisted" : isShortlistedStage(match.stage) ? "screening" : match.stage;
        return NextResponse.json({ ok: true, ...(await moveStage({ organizationId: recruiter.organizationId, matchId: match.id, to, actorId: recruiter.id })) });
      }
      case "override": {
        if (input.score === undefined && input.tier === undefined) throw new ApiError(400, "Give a score or a tier to override.");
        await prisma.matchScore.update({ where: { id: match.id }, data: { overrideScore: input.score ?? null, overrideTier: input.tier ?? null, overrideReason: input.reason, overrideById: recruiter.id, overrideAt: new Date() } });
        await recordEvent({ ...base, kind: "override", data: { aiScore: match.score, aiTier: match.tier, score: input.score, tier: input.tier, reason: input.reason } });
        return NextResponse.json({ ok: true });
      }
      case "clear_override": {
        await prisma.matchScore.update({ where: { id: match.id }, data: { overrideScore: null, overrideTier: null, overrideReason: null, overrideById: null, overrideAt: null } });
        await recordEvent({ ...base, kind: "override_cleared" });
        return NextResponse.json({ ok: true });
      }
      case "note": {
        const note = await prisma.candidateNote.create({ data: { matchId: match.id, authorId: recruiter.id, body: input.body } });
        await recordEvent({ ...base, kind: "note", data: { noteId: note.id } });
        return NextResponse.json({ ok: true, note }, { status: 201 });
      }
      case "interview": {
        const row = await prisma.interview.create({ data: { matchId: match.id, scheduledAt: new Date(input.scheduledAt), mode: input.mode, interviewers: input.interviewers ?? null, outcome: input.outcome ?? null, notes: input.notes ?? null, createdById: recruiter.id } });
        await recordEvent({ ...base, kind: "interview", data: { interviewId: row.id, at: input.scheduledAt } });
        if (["new", "sourced", "screening", "shortlisted", "contacted"].includes(match.stage)) await moveStage({ organizationId: recruiter.organizationId, matchId: match.id, to: "interview_scheduled", actorId: recruiter.id });
        return NextResponse.json({ ok: true, interview: row }, { status: 201 });
      }
      case "reminder": {
        const row = await prisma.reminder.create({ data: { matchId: match.id, dueAt: new Date(input.dueAt), text: input.text, createdById: recruiter.id } });
        await recordEvent({ ...base, kind: "reminder", data: { reminderId: row.id, dueAt: input.dueAt } });
        return NextResponse.json({ ok: true, reminder: row }, { status: 201 });
      }
      case "reminder_done": {
        await prisma.reminder.updateMany({ where: { id: input.reminderId, matchId: match.id }, data: { doneAt: new Date() } });
        return NextResponse.json({ ok: true });
      }
    }
  });
}
