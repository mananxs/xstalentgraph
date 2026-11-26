import { startEmbeddedWorker } from "./worker/loop";

// Node.js runtime only (imported from instrumentation.ts).
if (process.env.EMBEDDED_WORKER !== "false" && process.env.DATABASE_URL) {
  try {
    startEmbeddedWorker();
  } catch (error) {
    // Never block the web server from starting.
    console.error("[talentgraph] could not start the embedded worker:", error);
  }
}
