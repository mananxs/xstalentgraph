import { setAiScope, withAiScope } from "./scope";
import { loadActiveKeys } from "./userKeys";

/** Called after sign-in is resolved: the request's AI calls now try this recruiter's own keys first. Never throws. */
export async function bindRecruiterAi(recruiterId: string): Promise<void> {
  const keys = await loadActiveKeys(recruiterId).catch(() => []);
  setAiScope({ recruiterId, keys });
}

/** Runs background work (worker batches, AI queues) on a recruiter's own keys. */
export async function runAsRecruiterAi<T>(recruiterId: string, fn: () => Promise<T>): Promise<T> {
  const keys = await loadActiveKeys(recruiterId).catch(() => []);
  return withAiScope(fn, { recruiterId, keys });
}
