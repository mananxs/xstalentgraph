import { K, type ActiveJob, type AgentRun, type AgentRunState, type Config, type FieldVerdict, type JobSummary, type ProfileSnapshot, type SearchFill } from "../shared/types";
import { toActive } from "../sidepanel/searchParams";

/**
 * XS-Hunt agent (service-worker side): the extension's half of the platform <-> extension protocol.
 *
 *   heartbeat  -> platform: "I am alive, and in the Resdex tab I SEE: signed_in / signed_out / captcha / expired / no_tab"
 *   platform   -> commands: check_session, apply_filters, start/pause/resume/stop_sourcing, retrieve_profiles
 *   extension  -> ack, then a RESULT that says what really happened (filters are read back from the Naukri form first)
 *   page agent -> capture (cards per result page), events (progress / warnings / errors)
 *
 * No Naukri cookie, token or session value ever leaves the browser: the platform only receives card text, profile text, CV files the
 * recruiter's own session was allowed to open, and status words.
 * Everything is persisted in chrome.storage.local, so a restarted browser or a killed worker picks up where it stopped.
 */

export interface AgentDeps {
  chrome: typeof chrome;
  fetch: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Extension version reported to the platform. */
  version?: string;
}

type Json = Record<string, unknown>;
export interface Command {
  id: string;
  taskId: string;
  messageId: string;
  type: string;
  payload: Json;
  status: string;
}
interface RetrievalItem {
  id: string;
  candidateId: string;
  name: string | null;
  profileUrl: string | null;
}
interface RetrievalState {
  commandId: string;
  jobId: string;
  items: RetrievalItem[];
  index: number;
  results: Array<{ requestId: string; status: "done" | "partial" | "failed" | "unavailable"; reason?: string }>;
  returnUrl: string | null;
}

export const AGENT = { run: "agent.run", deviceId: "agent.deviceId", processed: "agent.processed", outbox: "agent.outbox", tab: "agent.tabId", status: "agent.status", retrieval: "agent.retrieval" } as const;
const RESDEX = "https://resdex.naukri.com/";
const MAX_PROCESSED = 200;

export interface AgentStatus {
  connected: boolean;
  lastOkAt: number | null;
  error: string | null;
  naukri: string;
  taskId: string | null;
  run: AgentRun | null;
  note: string | null;
}

export function createAgent(deps: AgentDeps) {
  const c = deps.chrome;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const version = deps.version ?? "2.0.0";
  let ticking = false;
  let lastTickAt = 0;

  /* ───────────── storage helpers ───────────── */
  const get = async <T>(key: string): Promise<T | undefined> => ((await c.storage.local.get(key))[key] as T | undefined);
  const set = (key: string, value: unknown) => c.storage.local.set({ [key]: value });
  async function patchStatus(p: Partial<AgentStatus>) {
    const cur = (await get<AgentStatus>(AGENT.status)) ?? { connected: false, lastOkAt: null, error: null, naukri: "unknown", taskId: null, run: null, note: null };
    await set(AGENT.status, { ...cur, ...p });
  }
  async function deviceId(): Promise<string> {
    let id = await get<string>(AGENT.deviceId);
    if (!id) {
      id = `dev-${crypto.randomUUID()}`;
      await set(AGENT.deviceId, id);
    }
    return id;
  }

  /* ───────────── platform calls ───────────── */
  class Unauthorized extends Error {}
  async function api<T>(path: string, body?: unknown, formData?: FormData): Promise<T> {
    const cfg = await get<Config>(K.config);
    if (!cfg?.baseUrl || !cfg.apiKey) throw new Unauthorized("Not logged in to XS-Hunt.");
    let res: Response;
    try {
      res = await deps.fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/api/extension${path}`, {
        method: body === undefined && !formData ? "GET" : "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(formData ? {} : { "Content-Type": "application/json" }) },
        body: formData ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
    } catch {
      throw new Error(`Cannot reach ${cfg.baseUrl}.`);
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) throw new Unauthorized(data.error ?? "Session expired.");
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data as T;
  }

  /* ───────────── the controlled Resdex tab ───────────── */
  async function resdexTabs(): Promise<chrome.tabs.Tab[]> {
    return c.tabs.query({ url: `${RESDEX}*` }).catch(() => []);
  }
  async function findTab(): Promise<number | null> {
    const saved = await get<number>(AGENT.tab);
    const tabs = await resdexTabs();
    if (saved && tabs.some((t) => t.id === saved)) return saved;
    const pick = tabs.find((t) => t.active) ?? tabs[0];
    if (pick?.id) {
      await set(AGENT.tab, pick.id);
      return pick.id;
    }
    return null;
  }
  async function ensureTab(): Promise<number> {
    const existing = await findTab();
    if (existing) return existing;
    const tab = await c.tabs.create({ url: RESDEX, active: false });
    await waitComplete(tab.id!);
    await set(AGENT.tab, tab.id);
    return tab.id!;
  }
  async function waitComplete(tabId: number, timeoutMs = 30_000): Promise<void> {
    const start = now();
    while (now() - start < timeoutMs) {
      const t = await c.tabs.get(tabId).catch(() => null);
      if (!t) throw new Error("The Resdex tab was closed.");
      if (t.status === "complete") return;
      await sleep(400);
    }
    throw new Error("The Resdex page did not finish loading.");
  }
  async function ask<T = Json>(tabId: number, msg: Json, retried = false): Promise<T> {
    try {
      return (await c.tabs.sendMessage(tabId, msg)) as T;
    } catch (e) {
      if (retried) throw e;
      await c.scripting.executeScript({ target: { tabId }, files: ["content.js", "agent.js"] }).catch(() => {});
      await sleep(400);
      return ask<T>(tabId, msg, true);
    }
  }
  async function sessionNow(): Promise<{ state: string; tabId: number | null }> {
    const tabId = await findTab();
    if (!tabId) return { state: "no_tab", tabId: null };
    try {
      const r = await ask<{ ok?: boolean; session?: string }>(tabId, { type: "AGENT_SESSION" });
      return { state: r?.session && r.session !== "unknown" ? r.session : "unknown", tabId };
    } catch {
      return { state: "unknown", tabId };
    }
  }

  /* ───────────── outbox: never lose a captured page ───────────── */
  async function flushOutbox() {
    const box = (await get<Array<{ taskId: string; page: number; cards: unknown[] }>>(AGENT.outbox)) ?? [];
    if (!box.length) return;
    const left: typeof box = [];
    for (const item of box) {
      try {
        await api("/agent/capture", item);
      } catch (e) {
        if (e instanceof Unauthorized) throw e;
        if (/not found|404/i.test((e as Error).message)) continue; // the task is gone: drop it
        left.push(item);
      }
    }
    await set(AGENT.outbox, left.slice(-50));
  }

  async function capture(taskId: string, page: number, cards: unknown[]) {
    try {
      return await api<{ captured: number; duplicates: number; limitReached: boolean }>("/agent/capture", { taskId, page, cards });
    } catch (e) {
      if (e instanceof Unauthorized) throw e;
      const box = (await get<unknown[]>(AGENT.outbox)) ?? [];
      await set(AGENT.outbox, [...box, { taskId, page, cards }].slice(-50));
      throw e;
    }
  }

  async function event(taskId: string, kind: string, message: string, data: Json = {}, state?: AgentRunState, error?: string) {
    try {
      await api("/agent/events", { taskId, events: [{ kind, message, data }], ...(state ? { state } : {}), ...(error ? { error } : {}) });
    } catch {
      /* progress events are best effort */
    }
  }

  /* ───────────── commands ───────────── */
  const processedMap = async () => ((await get<Record<string, { at: number; result: Json }>>(AGENT.processed)) ?? {});
  async function remember(messageId: string, result: Json) {
    const map = await processedMap();
    map[messageId] = { at: now(), result };
    const keep = Object.entries(map).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_PROCESSED);
    await set(AGENT.processed, Object.fromEntries(keep));
  }

  async function adoptJob(payload: Json) {
    const job = payload.job as JobSummary | undefined;
    if (job?.id) await set(K.activeJob, toActive(job) satisfies ActiveJob);
  }

  async function setRun(patch: Partial<AgentRun> & { taskId: string }): Promise<AgentRun> {
    const cur = await get<AgentRun>(AGENT.run);
    const next: AgentRun = cur && cur.taskId === patch.taskId ? { ...cur, ...patch } : { state: "idle", limits: { maxPages: 5, maxCandidates: 100, delaySeconds: 6 }, page: 1, pagesDone: 0, captured: 0, ...patch };
    await set(AGENT.run, next);
    return next;
  }

  async function execute(cmd: Command): Promise<Json> {
    const p = cmd.payload;
    switch (cmd.type) {
      case "check_session": {
        const s = await sessionNow();
        return { status: "done", session: s.state };
      }
      case "apply_filters": {
        await adoptJob(p);
        const tabId = await ensureTab();
        const fill = p.filters as SearchFill;
        const report = await ask<{ ok?: boolean; error?: string; fields?: Array<{ key: string; status: "filled" | "manual" | "missing" }> }>(tabId, { type: "FILL_RESDEX_SEARCH", fields: fill });
        if (!report || report.ok === false) return { status: "failed", error: report?.error ?? "Resdex did not accept the search fields (is the page a Resdex search page?)." };
        await sleep(600); // let the form settle before reading it back
        const filled = Object.fromEntries((report.fields ?? []).map((f) => [f.key, f.status]));
        const verify = await ask<{ ok?: boolean; fields?: Record<string, FieldVerdict> }>(tabId, { type: "AGENT_VERIFY_FILTERS", fill, filled });
        if (!verify?.fields) return { status: "failed", error: "The filters were typed but could not be read back, so they are not confirmed." };
        return { status: "done", fields: verify.fields };
      }
      case "start_sourcing":
      case "resume_sourcing": {
        await adoptJob(p);
        const limits = (p.limits as AgentRun["limits"] | undefined) ?? undefined;
        const run = await setRun({ taskId: cmd.taskId, jobId: (p.job as JobSummary | undefined)?.id, state: "running", ...(limits ? { limits } : {}) });
        const tabId = await ensureTab();
        const s = await sessionNow();
        if (s.state !== "signed_in") {
          await setRun({ taskId: cmd.taskId, state: "paused" });
          return { status: "failed", error: `Naukri is not ready (${s.state.replace("_", " ")}). Sign in to Resdex and start again.` };
        }
        await ask(tabId, { type: "AGENT_RUN" }).catch(() => null);
        return { status: "done", state: run.state };
      }
      case "pause_sourcing":
        await setRun({ taskId: cmd.taskId, state: "paused" });
        return { status: "done", state: "paused" };
      case "stop_sourcing":
        await setRun({ taskId: cmd.taskId, state: "stopped" });
        return { status: "done", state: "stopped" };
      case "retrieve_profiles":
        return retrieve(cmd);
      default:
        return { status: "failed", error: `Unknown command ${cmd.type}` };
    }
  }

  /* ───────────── credit-gated profile / CV retrieval ───────────── */
  async function retrieve(cmd: Command): Promise<Json> {
    const p = cmd.payload;
    if (p.creditAck !== true) return { status: "failed", error: "The recruiter did not approve the Naukri credit warning." };
    const jobId = (p.job as JobSummary | undefined)?.id ?? "";
    let st = await get<RetrievalState>(AGENT.retrieval);
    if (!st || st.commandId !== cmd.id) {
      const tabId0 = await ensureTab();
      const tab = await c.tabs.get(tabId0).catch(() => null);
      st = { commandId: cmd.id, jobId, items: (p.requests as RetrievalItem[]) ?? [], index: 0, results: [], returnUrl: tab?.url ?? null };
      await set(AGENT.retrieval, st);
    }
    await adoptJob(p);
    const tabId = await ensureTab();
    for (; st.index < st.items.length; st.index++) {
      const item = st.items[st.index]!;
      let outcome: RetrievalState["results"][number];
      try {
        outcome = await retrieveOne(tabId, jobId, item);
      } catch (e) {
        outcome = { requestId: item.id, status: "failed", reason: (e as Error).message };
      }
      st.results.push(outcome);
      await set(AGENT.retrieval, st); // progress survives a worker restart; a finished candidate is never opened again
      if (outcome.reason && /session|captcha|signed/i.test(outcome.reason) && outcome.status === "failed") {
        for (st.index++; st.index < st.items.length; st.index++) st.results.push({ requestId: st.items[st.index]!.id, status: "failed", reason: "Stopped: the Naukri session was lost." });
        break;
      }
      if (st.index < st.items.length - 1) await sleep(4000 + Math.random() * 4000); // behave like a person, one profile at a time
    }
    if (st.returnUrl) await c.tabs.update(tabId, { url: st.returnUrl }).catch(() => null);
    await c.storage.local.remove(AGENT.retrieval);
    return { status: "done", items: st.results };
  }

  async function retrieveOne(tabId: number, jobId: string, item: RetrievalItem): Promise<RetrievalState["results"][number]> {
    if (!item.profileUrl || !/^https:\/\/([\w-]+\.)*naukri\.com\//i.test(item.profileUrl)) return { requestId: item.id, status: "unavailable", reason: "No usable Naukri profile link for this candidate." };
    await c.tabs.update(tabId, { url: item.profileUrl });
    await sleep(800);
    await waitComplete(tabId);
    await sleep(2500);
    const s = await ask<{ session?: string }>(tabId, { type: "AGENT_SESSION" }).catch(() => ({ session: "unknown" }));
    if (s.session && s.session !== "signed_in" && s.session !== "unknown") return { requestId: item.id, status: "failed", reason: `Naukri session problem (${s.session.replace("_", " ")}); stopped.` };
    const prof = await ask<ProfileSnapshot>(tabId, { type: "READ_PROFILE" }).catch(() => null);
    if (!prof?.open) return { requestId: item.id, status: "unavailable", reason: "Naukri did not show the full profile. It may need a view credit, or the link has expired. Nothing was spent by XS-Hunt." };

    const { audit } = await api<{ audit: Json }>("/score-profile", { jobId, rawText: prof.rawText, profileUrl: prof.url });
    const saved = await api<{ candidate: { id: string } }>("/import-candidate", { jobId, profileUrl: prof.url, rawText: prof.rawText, audit });
    const link = prof.cvLinks[0];
    if (!link) return { requestId: item.id, status: "partial", reason: "Profile saved. No CV download link is visible on this profile." };
    const got = await ask<{ ok: boolean; error?: string; name?: string; mime?: string; base64?: string }>(tabId, { type: "FETCH_CV", href: link.href }).catch(() => null);
    if (!got?.ok || !got.base64) return { requestId: item.id, status: "partial", reason: `Profile saved. CV not retrieved: ${got?.error ?? "download failed"}.` };
    const bytes = Uint8Array.from(atob(got.base64), (ch) => ch.charCodeAt(0));
    const fd = new FormData();
    fd.append("file", new File([bytes], got.name ?? "cv.pdf", { type: got.mime }));
    await api(`/candidates/${saved.candidate.id}/resume`, undefined, fd);
    return { requestId: item.id, status: "done" };
  }

  /* ───────────── reconciling the desired run state ───────────── */
  async function reconcile(tasks: Array<{ id: string; sourcingState: string }>) {
    const run = await get<AgentRun>(AGENT.run);
    if (!run) return;
    const desired = tasks.find((t) => t.id === run.taskId)?.sourcingState;
    if (!desired) {
      if (run.state === "running") await setRun({ taskId: run.taskId, state: "stopped" }); // the task is gone
      return;
    }
    if (desired === "stopped" && run.state !== "stopped") await setRun({ taskId: run.taskId, state: "stopped" });
    else if (desired === "paused" && run.state === "running") await setRun({ taskId: run.taskId, state: "paused" });
    else if (desired === "completed" && run.state === "running") await setRun({ taskId: run.taskId, state: "completed" });
  }

  async function keepRunnerAlive() {
    const run = await get<AgentRun>(AGENT.run);
    if (run?.state !== "running") return;
    const tabId = await findTab();
    if (tabId) await ask(tabId, { type: "AGENT_RUN" }).catch(() => null);
  }

  /* ───────────── the tick ───────────── */
  async function tick(force = false): Promise<void> {
    if (ticking || (!force && now() - lastTickAt < 8000)) return;
    ticking = true;
    lastTickAt = now();
    try {
      const cfg = await get<Config>(K.config);
      if (!cfg?.apiKey) return;
      const s = await sessionNow();
      await flushOutbox().catch(() => {});
      let hb: { commands: Command[]; tasks: Array<{ id: string; sourcingState: string }> };
      try {
        hb = await api("/agent/heartbeat", { deviceId: await deviceId(), version, naukri: { state: s.state === "unknown" ? "unknown" : s.state, tabOpen: s.tabId !== null } });
      } catch (e) {
        await patchStatus({ connected: false, error: (e as Error).message, naukri: s.state });
        return;
      }
      const run = (await get<AgentRun>(AGENT.run)) ?? null;
      await patchStatus({ connected: true, lastOkAt: now(), error: null, naukri: s.state, taskId: run?.taskId ?? null, run });

      const done = await processedMap();
      for (const cmd of hb.commands ?? []) {
        // A command we already finished (but whose result never reached the platform) is answered from memory, never executed twice.
        if (done[cmd.messageId]) {
          await api(`/agent/commands/${cmd.id}/result`, done[cmd.messageId]!.result).catch(() => {});
          continue;
        }
        await api(`/agent/commands/${cmd.id}/ack`, {}).catch(() => {});
        let result: Json;
        try {
          result = await execute(cmd);
        } catch (e) {
          result = { status: "failed", error: (e as Error).message.slice(0, 400) };
        }
        await remember(cmd.messageId, result);
        await api(`/agent/commands/${cmd.id}/result`, result).catch(() => {});
        await patchStatus({ note: `${cmd.type}: ${result.status}` });
      }
      await reconcile(hb.tasks ?? []);
      await keepRunnerAlive();
      const after = (await get<AgentRun>(AGENT.run)) ?? null;
      await patchStatus({ run: after, taskId: after?.taskId ?? null });
    } finally {
      ticking = false;
    }
  }

  /* ───────────── page agent -> platform relays ───────────── */
  async function onRunState(taskId: string, state: AgentRunState, reason?: string) {
    await setRun({ taskId, state });
    await event(taskId, reason ? "session" : "info", reason ? `Sourcing ${state}: ${reason}` : `Sourcing ${state}`, {}, state);
  }

  return { tick, capture, event, onRunState, execute, sessionNow, deviceId, AGENT };
}

export type Agent = ReturnType<typeof createAgent>;
