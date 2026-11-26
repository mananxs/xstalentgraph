/**
 * Runs once when the Next.js server starts.
 * Starts the embedded background worker, so "Find candidates" works with just `npm run dev`
 * (no more runs stuck in "Queued" because the second terminal was forgotten).
 * Set EMBEDDED_WORKER=false to turn it off (e.g. when a separate worker service runs in production).
 *
 * The NEXT_RUNTIME check must wrap the import exactly like this: it lets Next.js drop the Node-only
 * worker code (Prisma, pino) from the Edge build of this file.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
