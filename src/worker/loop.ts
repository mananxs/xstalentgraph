/**
 * The worker loop, shared by `npm run worker` (its own process) and the embedded worker that
 * `npm run dev` / `npm start` start inside the web server (src/instrumentation.ts).
 * Several loops can run at once safely: the claim query uses FOR UPDATE SKIP LOCKED.
 */
import { createLogger } from "@/server/logger";
import { claimNextQueuedBatch, requeueStaleBatches } from "@/server/repositories/batchRepository";
import { runBatch } from "@/server/pipeline/runBatch";
import { runAsRecruiterAi } from "@/server/ai/bind";

const log = createLogger("worker");

const POLL_INTERVAL_MS = 2000;
/** Wait longer between polls while the database is unreachable, so logs do not flood. */
const ERROR_BACKOFF_MS = 15_000;
/** A running batch whose progress has not moved for this long belongs to a dead worker. */
const STALE_AFTER_MINUTES = 5;
const STALE_CHECK_EVERY_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WorkerLoopOptions {
  /** Return true to stop after the current batch. */
  shouldStop: () => boolean;
  name?: string;
}

/** Polls for queued batches forever (until shouldStop). Never throws. */
export async function runWorkerLoop({ shouldStop, name = "worker" }: WorkerLoopOptions): Promise<void> {
  log.info({ name }, "worker started, waiting for queued batches");
  let lastStaleCheck = 0;

  while (!shouldStop()) {
    let delay = POLL_INTERVAL_MS;
    try {
      if (Date.now() - lastStaleCheck > STALE_CHECK_EVERY_MS) {
        lastStaleCheck = Date.now();
        const requeued = await requeueStaleBatches(STALE_AFTER_MINUTES);
        if (requeued > 0) log.warn({ requeued }, "put stale running batches back in the queue");
      }

      const batch = await claimNextQueuedBatch();
      if (batch) {
        // The batch runs on its requester's own AI keys first (platform key as the fallback).
        await runAsRecruiterAi(batch.requestedById, () => runBatch(batch));
        continue; // look for the next batch right away
      }
    } catch (error) {
      // A database hiccup must not kill the worker.
      log.error({ err: error instanceof Error ? error.message : error }, "worker loop error, retrying shortly");
      delay = ERROR_BACKOFF_MS;
    }
    await sleep(delay);
  }
  log.info({ name }, "worker stopped");
}

const globalForWorker = globalThis as unknown as { __talentgraphWorker?: boolean };

/** Starts ONE embedded worker per server process (safe to call many times, e.g. after hot reloads). */
export function startEmbeddedWorker(): void {
  if (globalForWorker.__talentgraphWorker) return;
  globalForWorker.__talentgraphWorker = true;
  void runWorkerLoop({ shouldStop: () => false, name: "embedded" }).catch((error: unknown) => {
    globalForWorker.__talentgraphWorker = false;
    log.error({ err: error }, "embedded worker stopped unexpectedly");
  });
}
