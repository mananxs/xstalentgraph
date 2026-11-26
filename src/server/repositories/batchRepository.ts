import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

const batchSelect = {
  id: true,
  jobId: true,
  status: true,
  maxProfiles: true,
  source: true,
  profilesFound: true,
  candidatesUpserted: true,
  embeddedCount: true,
  evaluationTotal: true,
  evaluatedCount: true,
  failedCount: true,
  error: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
} satisfies Prisma.IngestionBatchSelect;

/** A batch as the API and the UI see it. */
export type BatchView = Prisma.IngestionBatchGetPayload<{ select: typeof batchSelect }>;

/** What the worker needs after claiming a batch. */
export interface ClaimedBatch {
  id: string;
  jobId: string;
  requestedById: string;
  maxProfiles: number;
  /** "github", or the external sources of this run joined with "+": "linkedin", "cutshort", "linkedin+cutshort". */
  source: string;
  /** Profile URLs to scrape (LinkedIn runs only). */
  linkedinUrls: string[];
}

/**
 * Creates a queued batch, unless this job already has one queued or running.
 * The check and the insert are ONE statement, so two quick clicks cannot create two batches.
 * @returns The new batch id, or null when a batch is already active.
 */
export async function createQueuedBatch(params: {
  jobId: string;
  requestedById: string;
  maxProfiles: number;
  /** Defaults to a GitHub search. "linkedin" searches Google X-Ray (Apify), or uses `linkedinUrls` when given. */
  source?: string;
  linkedinUrls?: string[];
}): Promise<string | null> {
  const { jobId, requestedById, maxProfiles, source = "github", linkedinUrls = [] } = params;

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO ingestion_batches ("jobId", "requestedById", "maxProfiles", "source", "linkedinUrls", "status", "updatedAt")
    SELECT ${jobId}::uuid, ${requestedById}::uuid, ${maxProfiles}::int, ${source}, ${linkedinUrls}::text[], 'queued'::"BatchStatus", now()
    WHERE NOT EXISTS (
      SELECT 1 FROM ingestion_batches
      WHERE "jobId" = ${jobId}::uuid AND "status" IN ('queued', 'running')
    )
    RETURNING "id"
  `;

  return rows[0]?.id ?? null;
}

/** Loads one batch of a job (the job id in the filter stops people reading other jobs' batches). */
export async function findBatchOfJob(batchId: string, jobId: string): Promise<BatchView | null> {
  return prisma.ingestionBatch.findFirst({ where: { id: batchId, jobId }, select: batchSelect });
}

/** The most recent batch of a job, or null if it was never run. */
export async function findLatestBatchOfJob(jobId: string): Promise<BatchView | null> {
  return prisma.ingestionBatch.findFirst({
    where: { jobId },
    orderBy: { createdAt: "desc" },
    select: batchSelect,
  });
}

/**
 * Worker: takes the oldest queued batch and marks it running, in one statement.
 * FOR UPDATE SKIP LOCKED means two workers never take the same batch,
 * and a worker never waits on a row another worker is claiming.
 */
export async function claimNextQueuedBatch(): Promise<ClaimedBatch | null> {
  const rows = await prisma.$queryRaw<ClaimedBatch[]>`
    UPDATE ingestion_batches
    SET "status" = 'running', "startedAt" = now(), "updatedAt" = now()
    WHERE "id" = (
      SELECT "id" FROM ingestion_batches
      WHERE "status" = 'queued'
      ORDER BY "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "jobId", "requestedById", "maxProfiles", "source", "linkedinUrls"
  `;

  return rows[0] ?? null;
}

/**
 * Worker start-up: a batch stuck in "running" (the worker crashed) goes back to the queue.
 * Re-running is safe because every step is an upsert.
 * @returns How many batches were put back.
 */
export async function requeueStaleBatches(staleAfterMinutes: number): Promise<number> {
  return prisma.$executeRaw`
    UPDATE ingestion_batches
    SET "status" = 'queued', "updatedAt" = now()
    WHERE "status" = 'running'
      AND "updatedAt" < now() - make_interval(mins => ${staleAfterMinutes}::int)
  `;
}

export type BatchCounters = Partial<
  Pick<BatchView, "profilesFound" | "candidatesUpserted" | "embeddedCount" | "evaluationTotal">
>;

/** Saves progress numbers (also refreshes updatedAt, which proves the worker is alive). */
export async function updateBatchCounters(batchId: string, counters: BatchCounters): Promise<void> {
  await prisma.ingestionBatch.update({ where: { id: batchId }, data: counters });
}

/** Adds one to evaluatedCount or failedCount. */
export async function incrementBatchResult(batchId: string, result: "evaluated" | "failed"): Promise<void> {
  await prisma.ingestionBatch.update({
    where: { id: batchId },
    data: result === "evaluated" ? { evaluatedCount: { increment: 1 } } : { failedCount: { increment: 1 } },
  });
}

/** Marks the batch completed. `note` (optional) is shown in the UI, e.g. why some candidates got a Quick score. */
export async function completeBatch(batchId: string, note?: string): Promise<void> {
  await prisma.ingestionBatch.update({
    where: { id: batchId },
    data: { status: "completed", finishedAt: new Date(), error: note ? note.slice(0, 1000) : null },
  });
}

/** Marks the batch failed and saves the reason (shown in the UI). */
export async function failBatch(batchId: string, error: string): Promise<void> {
  await prisma.ingestionBatch.update({
    where: { id: batchId },
    data: { status: "failed", finishedAt: new Date(), error: error.slice(0, 1000) },
  });
}
