/**
 * Stand-alone background worker:  npm run worker
 * Optional: `npm run dev` already runs an embedded worker (EMBEDDED_WORKER=true). Running this as well is
 * safe (batches are claimed with FOR UPDATE SKIP LOCKED) and useful in production, where the web server
 * and the worker usually scale separately.
 */
import { prisma } from "@/server/db";
import { createLogger } from "@/server/logger";
import { runWorkerLoop } from "./loop";

const log = createLogger("worker");
let stopRequested = false;

// Ctrl+C: finish the batch that is running, then stop.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.info({ signal }, "stop requested, finishing the current batch first");
    stopRequested = true;
  });
}

// One unexpected rejection (a library bug, a dropped socket) must not take the worker down.
process.on("unhandledRejection", (reason) => log.error({ err: reason }, "unhandled promise rejection (worker keeps running)"));
process.on("uncaughtException", (error) => log.error({ err: error }, "uncaught exception (worker keeps running)"));

runWorkerLoop({ shouldStop: () => stopRequested })
  .catch((error: unknown) => log.fatal({ err: error }, "worker crashed"))
  .finally(() => void prisma.$disconnect());
