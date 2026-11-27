import { AsyncLocalStorage } from "node:async_hooks";

/** One of a recruiter's own, currently usable AI keys. */
export interface UserKey {
  id: string;
  provider: "groq" | "gemini";
  key: string;
}

/** Who the AI call is for. Set once per request (or per background job); the LLM client reads it at call time. */
export interface AiScope {
  recruiterId: string | null;
  keys: UserKey[];
}

const als = new AsyncLocalStorage<AiScope>();

export const currentAiScope = (): AiScope | undefined => als.getStore();

/** Runs `fn` with an (initially empty) scope. handleRoute wraps every API request in one. */
export function withAiScope<T>(fn: () => Promise<T>, scope: AiScope = { recruiterId: null, keys: [] }): Promise<T> {
  return als.run(scope, fn);
}

/** Fills the current scope in place (so it survives every async hop of the request). Falls back to enterWith outside a scope. */
export function setAiScope(scope: AiScope): void {
  const cur = als.getStore();
  if (cur) {
    cur.recruiterId = scope.recruiterId;
    cur.keys = scope.keys;
  } else {
    als.enterWith({ ...scope });
  }
}
