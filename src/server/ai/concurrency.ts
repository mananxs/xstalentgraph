import pLimit from "p-limit";

/** A function that runs tasks, never more than N at the same time. */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Creates a limiter. Tasks can be added at any moment (for example while GitHub pages are still arriving)
 * and they all share the same "at most N at once" budget.
 */
export function createLimiter(concurrency: number): Limiter {
  const limit = pLimit(concurrency);
  return (task) => limit(task);
}

/**
 * Runs `worker` for every item, but never more than `concurrency` at the same time.
 * The worker must handle its own errors: one failed item must not stop the others.
 */
export async function runWithConcurrency<TItem>(
  items: TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<void>,
): Promise<void> {
  const limit = createLimiter(concurrency);
  await Promise.all(items.map((item) => limit(() => worker(item))));
}
