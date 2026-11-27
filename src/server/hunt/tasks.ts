import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { parseCard } from "@/server/extension/cardParse";
import { jobSummary, resdexPlan } from "@/server/extension/rubric";
import type { RecruiterContext } from "@/server/repositories/recruiterRepository";
import { findJobInOrganization, type JobDetails } from "@/server/repositories/jobRepository";
import { personKey } from "@/server/naukri/schema";
import { factsFromParsed } from "./facts";
import { configuredFilters, filtersFromPlan, filtersSchema, limitsSchema, toSearchFill, type SearchFilters, type TaskLimits } from "./filters";
import { ensureRubric, evaluateAndStore, recordEvent, resolveCandidate } from "./store";

/** An extension counts as connected only while its heartbeat is fresh. */
export const HEARTBEAT_FRESH_MS = 45_000;
/** A command the extension acknowledged but never finished is offered again after this long (browser restarted, worker killed ...). */
export const ACK_STALE_MS = 120_000;

export type RunState = "idle" | "running" | "paused" | "stopped" | "completed";

const json = (value: unknown) => value as Prisma.InputJsonValue;

export interface ConnectionView {
  connected: boolean;
  /** never = no extension has ever connected for this recruiter. */
  state: "connected" | "disconnected" | "never";
  lastSeenAt: string | null;
  version: string | null;
  /** signed_in | signed_out | captcha | expired | no_tab | unknown, exactly as last observed in the Resdex tab. Stale when disconnected. */
  naukri: string;
  naukriCheckedAt: string | null;
}

export async function connectionView(recruiterId: string, now = Date.now()): Promise<ConnectionView> {
  const row = await prisma.extensionConnection.findFirst({ where: { recruiterId }, orderBy: { lastSeenAt: "desc" } });
  if (!row) return { connected: false, state: "never", lastSeenAt: null, version: null, naukri: "unknown", naukriCheckedAt: null };
  const connected = now - row.lastSeenAt.getTime() < HEARTBEAT_FRESH_MS;
  return { connected, state: connected ? "connected" : "disconnected", lastSeenAt: row.lastSeenAt.toISOString(), version: row.version, naukri: connected ? row.naukriState : "unknown", naukriCheckedAt: row.naukriCheckedAt?.toISOString() ?? null };
}

export async function taskEvent(taskId: string, kind: string, message: string, data: Record<string, unknown> = {}) {
  await prisma.taskEvent.create({ data: { taskId, kind, message: message.slice(0, 500), data: json(data) } });
}

export async function createTask(job: JobDetails, recruiter: RecruiterContext, overrides: { filters?: unknown; limits?: unknown } = {}) {
  const rubric = await ensureRubric(job, recruiter.id);
  const filters = overrides.filters ? filtersSchema.parse(overrides.filters) : filtersFromPlan(resdexPlan(job));
  const limits = limitsSchema.parse(overrides.limits ?? {});
  const task = await prisma.sourcingTask.create({
    data: { organizationId: job.organizationId, jobId: job.id, createdById: recruiter.id, status: "active", filters: json(filters), limits: json(limits), rubricVersion: rubric.version },
  });
  await taskEvent(task.id, "created", "Sourcing task created");
  return task;
}

/** Messages to the extension are idempotent: the same messageId is never created twice. */
export async function queueCommand(taskId: string, type: string, payload: Record<string, unknown> = {}) {
  return prisma.sourcingCommand.create({ data: { taskId, type, payload: json(payload), messageId: randomUUID() } });
}

/** What the extension needs to know about the job: summary (title, rubric, search plan) so its scoring uses the right job. */
export async function jobPayload(jobId: string, organizationId: string, recruiterId: string) {
  const job = await findJobInOrganization(jobId, organizationId);
  if (!job) return null;
  const rubric = await ensureRubric(job, recruiterId);
  return { job: jobSummary(job, 0, rubric.version), description: job.description.slice(0, 20_000), rubricVersion: rubric.version };
}

export async function taskView(taskId: string, organizationId: string) {
  const task = await prisma.sourcingTask.findFirst({ where: { id: taskId, organizationId } });
  if (!task) return null;
  const [events, commands, pending, failed] = await Promise.all([
    prisma.taskEvent.findMany({ where: { taskId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.sourcingCommand.findMany({ where: { taskId }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, type: true, status: true, result: true, createdAt: true, doneAt: true } }),
    prisma.capturedCandidate.count({ where: { taskId, aiStatus: "pending" } }),
    prisma.capturedCandidate.count({ where: { taskId, aiStatus: "failed" } }),
  ]);
  return {
    id: task.id,
    jobId: task.jobId,
    status: task.status,
    sourcingState: task.sourcingState as RunState,
    aiState: task.aiState as RunState,
    filters: task.filters as unknown as SearchFilters,
    filterReport: task.filterReport as Record<string, { status: string; detail?: string }>,
    configured: configuredFilters(filtersSchema.parse(task.filters)),
    filtersAppliedAt: task.filtersAppliedAt?.toISOString() ?? null,
    limits: task.limits as unknown as TaskLimits,
    rubricVersion: task.rubricVersion,
    counters: { pagesDone: task.pagesDone, captured: task.capturedCount, duplicates: task.duplicateCount, analyzed: task.analyzedCount, failed: task.failedCount, aiPending: pending, aiFailed: failed },
    lastError: task.lastError,
    events: events.map((e) => ({ id: e.id, kind: e.kind, message: e.message, at: e.createdAt.toISOString() })),
    commands: commands.map((c) => ({ id: c.id, type: c.type, status: c.status, result: c.result, createdAt: c.createdAt.toISOString(), doneAt: c.doneAt?.toISOString() ?? null })),
    createdAt: task.createdAt.toISOString(),
  };
}

/**
 * Recruiter-facing control of the two independent processes. The change is saved first (the desired state) and, for sourcing,
 * a command is queued for the extension; the extension's own report later confirms what it actually did.
 */
export async function controlSourcing(taskId: string, recruiter: RecruiterContext, action: "start" | "pause" | "resume" | "stop", opts: { skipFilters?: boolean } = {}) {
  const task = await prisma.sourcingTask.findFirst({ where: { id: taskId, organizationId: recruiter.organizationId } });
  if (!task) throw new HttpError(404, "Task not found.");
  const from = task.sourcingState as RunState;
  const next: RunState = action === "start" ? "running" : action === "resume" ? "running" : action === "pause" ? "paused" : "stopped";
  if (action === "start" && from === "running") throw new HttpError(409, "Sourcing is already running.");
  if (action === "start" && !task.filtersAppliedAt && !opts.skipFilters) throw new HttpError(409, "Apply the search filters on Naukri first, so you can review them before sourcing starts.");
  if (action === "pause" && from !== "running") throw new HttpError(409, "Sourcing is not running.");
  if (action === "resume" && from !== "paused") throw new HttpError(409, "Sourcing is not paused.");
  if (action === "stop" && (from === "idle" || from === "stopped" || from === "completed")) throw new HttpError(409, "Sourcing is not active.");
  await prisma.sourcingTask.update({ where: { id: task.id }, data: { sourcingState: next, lastError: null, completedAt: null } });
  const payload = { ...(await jobPayload(task.jobId, task.organizationId, recruiter.id)), limits: task.limits, filters: toSearchFill(filtersSchema.parse(task.filters)) };
  const command = await queueCommand(task.id, `${action}_sourcing`, payload);
  await taskEvent(task.id, "control", `Sourcing: ${action}`);
  return { command: command.id, state: next };
}

export async function controlAi(taskId: string, organizationId: string, action: "start" | "pause" | "resume" | "stop") {
  const task = await prisma.sourcingTask.findFirst({ where: { id: taskId, organizationId } });
  if (!task) throw new HttpError(404, "Task not found.");
  const from = task.aiState as RunState;
  const next: RunState = action === "pause" ? "paused" : action === "stop" ? "stopped" : "running";
  if ((action === "start" || action === "resume") && from === "running") throw new HttpError(409, "AI analysis is already running.");
  if (action === "pause" && from !== "running") throw new HttpError(409, "AI analysis is not running.");
  await prisma.sourcingTask.update({ where: { id: task.id }, data: { aiState: next } });
  await taskEvent(task.id, "control", `AI analysis: ${action}`);
  return { state: next };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------------- capture (extension)

export interface IncomingCard {
  cardKey?: string;
  position: number;
  rawText: string;
  profileUrl?: string | null;
}

/**
 * Stores the cards the extension read from one result page. Idempotent per (task, cardKey): re-delivery after a network failure or a
 * browser restart creates nothing twice. Every card becomes (or is merged into) ONE candidate of the organization; people already
 * known (any source) are counted as duplicates. Evaluation is NOT done here: it waits in the AI queue.
 */
export async function captureCards(taskId: string, recruiter: RecruiterContext, page: number, cards: IncomingCard[]) {
  const task = await prisma.sourcingTask.findFirst({ where: { id: taskId, organizationId: recruiter.organizationId } });
  if (!task) throw new HttpError(404, "Task not found.");
  const limits = limitsSchema.parse(task.limits);
  let captured = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const card of cards.slice(0, 60)) {
    const parsed = parseCard(card.rawText);
    if (!parsed.fullName) {
      skipped += 1;
      continue;
    }
    if (task.capturedCount + captured >= limits.maxCandidates) break;
    const key = personKey({ fullName: parsed.fullName, currentCompany: parsed.currentCompany, expYears: parsed.expYears });
    const cardKey = card.cardKey?.slice(0, 80) || key;
    // One card at a time per (task, card): an advisory lock makes concurrent deliveries of the same card (two page agents, a retry racing
    // the original) wait for each other, so a person is never created twice and counters are never inflated.
    const outcome = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${taskId}:${cardKey}`}))`;
        const exists = await tx.capturedCandidate.findUnique({ where: { taskId_cardKey: { taskId, cardKey } }, select: { id: true } });
        if (exists) return null; // already delivered earlier
        const resolved = await resolveCandidate(
          {
            organizationId: task.organizationId,
            source: "naukri",
            externalId: key,
            name: parsed.fullName,
            profileUrl: card.profileUrl && /^https?:/.test(card.profileUrl) ? card.profileUrl : null,
            company: parsed.currentCompany || null,
            expYears: parsed.expYears >= 0 ? parsed.expYears : null,
            headline: parsed.headline || null,
            data: { ctcLpa: parsed.currentCtcLpa, noticeDays: parsed.noticeDays, location: parsed.location, education: parsed.education, skills: parsed.skills },
          },
          tx,
        );
        const before = await tx.candidate.findUniqueOrThrow({ where: { id: resolved.candidateId }, select: { primarySource: true, headline: true, location: true, skills: true, fullProfile: true } });
        if (!before.fullProfile) {
          const own = before.primarySource === "naukri";
          await tx.candidate.update({
            where: { id: resolved.candidateId },
            data: {
              name: own ? parsed.fullName : undefined,
              headline: own ? parsed.headline || undefined : before.headline ?? (parsed.headline || undefined),
              location: own ? parsed.location || undefined : before.location ?? (parsed.location || undefined),
              skills: own ? parsed.skills : [...new Set([...before.skills, ...parsed.skills])],
              experienceYears: parsed.expYears >= 0 ? parsed.expYears : undefined,
              ctc: parsed.currentCtcLpa >= 0 ? `${parsed.currentCtcLpa} LPA` : undefined,
              noticePeriod: parsed.noticeDays >= 0 ? parsed.noticePeriod : undefined,
              profileText: card.rawText.slice(0, 6000),
              lastIngestedAt: new Date(),
            },
          });
        }
        await tx.matchScore.upsert({
          where: { jobId_candidateId: { jobId: task.jobId, candidateId: resolved.candidateId } },
          create: { jobId: task.jobId, candidateId: resolved.candidateId, status: "pending", stage: "sourced" },
          update: {},
        });
        await tx.capturedCandidate.create({
          data: { organizationId: task.organizationId, taskId, jobId: task.jobId, cardKey, page, position: card.position, rawText: card.rawText.slice(0, 6000), parsed: json(parsed), profileUrl: card.profileUrl ?? null, candidateId: resolved.candidateId },
        });
        return { knownBefore: !resolved.created };
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
    if (!outcome) continue;
    const knownBefore = outcome.knownBefore;
    if (knownBefore) duplicates += 1;
    captured += 1;
  }

  const updated = await prisma.sourcingTask.update({
    where: { id: taskId },
    data: { capturedCount: { increment: captured }, duplicateCount: { increment: duplicates }, pagesDone: { set: Math.max(task.pagesDone, page) } },
    select: { capturedCount: true, pagesDone: true },
  });
  await recordEvent({ organizationId: task.organizationId, jobId: task.jobId, kind: "capture", actorId: recruiter.id, data: { taskId, page, captured, duplicates } });
  const limitReached = updated.capturedCount >= limits.maxCandidates || updated.pagesDone >= limits.maxPages;
  return { captured, duplicates, skipped, totals: { captured: updated.capturedCount, pagesDone: updated.pagesDone }, limitReached };
}

// ------------------------------------------------------------------------------------------------------- AI queue

/**
 * Evaluates the next waiting captured candidates of a task with the standard 7-dimension engine (the single analysis engine of the
 * platform). Runs only while the task's AI state is "running", unless `force` (the recruiter pressed "Analyze selected").
 * Bounded per call, so it is safe in a serverless request; callers loop until `remaining` is 0 or the state changes.
 */
export async function processAnalysisBatch(taskId: string, organizationId: string, opts: { limit?: number; force?: boolean } = {}) {
  const task = await prisma.sourcingTask.findFirst({ where: { id: taskId, organizationId } });
  if (!task) throw new HttpError(404, "Task not found.");
  if (task.aiState !== "running" && !opts.force) return { processed: 0, failed: 0, remaining: await prisma.capturedCandidate.count({ where: { taskId, aiStatus: "pending" } }), state: task.aiState as RunState };
  const job = await findJobInOrganization(task.jobId, organizationId);
  if (!job) throw new HttpError(404, "Job not found.");
  const rubric = await ensureRubric(job, task.createdById);
  const batch = await prisma.capturedCandidate.findMany({ where: { taskId, aiStatus: "pending", attempts: { lt: 3 } }, orderBy: [{ page: "asc" }, { position: "asc" }], take: Math.min(opts.limit ?? 20, 40) });
  let processed = 0;
  let failed = 0;
  for (const row of batch) {
    // Re-check between candidates so Pause / Stop take effect within one candidate.
    if (!opts.force) {
      const fresh = await prisma.sourcingTask.findUnique({ where: { id: taskId }, select: { aiState: true } });
      if (fresh?.aiState !== "running") break;
    }
    try {
      const parsed = (row.parsed ?? parseCard(row.rawText)) as ReturnType<typeof parseCard>;
      await evaluateAndStore({ job, rubric, candidateId: row.candidateId!, facts: factsFromParsed(parsed, row.rawText) });
      await prisma.capturedCandidate.update({ where: { id: row.id }, data: { aiStatus: "done", analyzedAt: new Date(), aiError: null, attempts: { increment: 1 } } });
      processed += 1;
    } catch (error) {
      failed += 1;
      const attempts = row.attempts + 1;
      await prisma.capturedCandidate.update({ where: { id: row.id }, data: { attempts, aiStatus: attempts >= 3 ? "failed" : "pending", aiError: (error as Error).message.slice(0, 300) } });
    }
  }
  const remaining = await prisma.capturedCandidate.count({ where: { taskId, aiStatus: "pending", attempts: { lt: 3 } } });
  const failedTotal = await prisma.capturedCandidate.count({ where: { taskId, aiStatus: "failed" } });
  const analyzedTotal = await prisma.capturedCandidate.count({ where: { taskId, aiStatus: "done" } });
  await prisma.sourcingTask.update({ where: { id: taskId }, data: { analyzedCount: analyzedTotal, failedCount: failedTotal, ...(remaining === 0 && task.aiState === "running" ? { aiState: "completed" } : {}) } });
  return { processed, failed, remaining, state: (remaining === 0 && task.aiState === "running" ? "completed" : task.aiState) as RunState };
}
