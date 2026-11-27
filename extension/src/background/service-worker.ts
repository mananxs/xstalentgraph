import {
  K,
  type Audit,
  type BgToContent,
  type CardResult,
  type CardSavePayload,
  type SaveMap,
  type Config,
  type ContentToBg,
  type DetailState,
  type JobSummary,
  type PanelToBg,
  type RankEntry,
  type Reply,
  type ActiveJob,
  type AnalyzedList,
  type SearchSessionInfo,
  type ProfileSnapshot,
  type RubricEdits,
  type SearchSnapshot,
  type Settings,
  DEFAULT_SETTINGS,
} from "../shared/types";
import { resultMatchesCard } from "../shared/util";
import { createAgent } from "./agent";

/**
 * Stateless router. Nothing lives in module variables (the MV3 worker is killed at will):
 *   chrome.storage.local   → config (incl. WHICH HR is logged in), activeJob, settings
 *   chrome.storage.session → per-tab ranking / detail / focus / live Naukri search state
 * All authenticated calls to the Co-Pilot backend are proxied here so keys never touch the page context.
 */

/** XS-Hunt agent: heartbeat + commands from the platform. See agent.ts. */
const agent = createAgent({ chrome, fetch: (...a) => fetch(...a), version: chrome.runtime.getManifest().version });
const ensureAlarm = () => chrome.alarms?.create("xs-hunt-tick", { periodInMinutes: 0.5, delayInMinutes: 0.1 });
chrome.alarms?.onAlarm.addListener((a) => a.name === "xs-hunt-tick" && void agent.tick(true).catch(() => {}));
ensureAlarm();
void agent.tick(true).catch(() => {});

/** Scoring always starts STOPPED (red): a browser restart, an update or a login can never burn AI quota by surprise. */
async function stopScoring() {
  const cur = ((await chrome.storage.local.get(K.settings))[K.settings] as Partial<Settings> | undefined) ?? {};
  await chrome.storage.local.set({ [K.settings]: { ...DEFAULT_SETTINGS, ...cur, scoring: false } });
}

chrome.runtime.onInstalled.addListener(async () => {
  ensureAlarm();
  await stopScoring().catch(() => {});
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Inject into Resdex tabs that were already open before install/update.
  const tabs = await chrome.tabs.query({ url: "https://resdex.naukri.com/*" }).catch(() => []);
  for (const t of tabs) if (t.id) await injectContent(t.id);
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void agent.tick(true).catch(() => {});
  void stopScoring().catch(() => {});
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([K.rank(tabId), K.detail(tabId), K.focus(tabId), K.saved(tabId), K.search(tabId), K.searchSession(tabId)]).catch(() => {});
});

/* Resdex is a single-page app: route changes (pushState / hash) don't reload the page, so tell the content script explicitly. */
const resdexNav = { url: [{ hostEquals: "resdex.naukri.com" }] };
const urlChanged = (d: { tabId: number; frameId: number }) => {
  if (d.frameId === 0) chrome.tabs.sendMessage(d.tabId, { type: "URL_CHANGED" } satisfies BgToContent).catch(() => {});
};
chrome.webNavigation?.onHistoryStateUpdated.addListener(urlChanged, resdexNav);
chrome.webNavigation?.onReferenceFragmentUpdated.addListener(urlChanged, resdexNav);

chrome.runtime.onMessage.addListener((msg: ContentToBg | PanelToBg, sender, sendResponse) => {
  route(msg, sender)
    .then((data) => sendResponse({ ok: true, data } satisfies Reply))
    .catch((e: Error & { code?: Reply["code"] }) => sendResponse({ ok: false, error: e.message, code: e.code } satisfies Reply));
  return true; // keep the channel open for the async response
});

async function route(msg: ContentToBg | PanelToBg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    /* ── from content script ── */
    case "SCORE_CARDS": {
      const job = await requireJob();
      const tabId = sender.tab?.id;
      // Link everything scored here to the Naukri search that produced the cards (so "Analyzed" can be listed per search).
      const session = tabId !== undefined ? await ensureSearchSession(tabId, job.id).catch(() => null) : null;
      const results: CardResult[] = [];
      const missing: string[] = [];
      const unscored: string[] = [];
      for (let i = 0; i < msg.cards.length; i += 20) {
        const chunk = msg.cards.slice(i, i + 20);
        const r = await api<{ results: CardResult[]; missing: string[]; unscored?: string[] }>("/score-batch", {
          jobId: job.id,
          candidates: chunk,
          onlyCached: msg.onlyCached || undefined,
          searchSessionId: session?.id,
        });
        results.push(...r.results);
        missing.push(...r.missing);
        unscored.push(...(r.unscored ?? []));
      }
      return { results, missing, unscored };
    }
    case "SEARCH_STATE": {
      const tabId = sender.tab?.id;
      await getConfig(); // nothing is kept for a logged-out browser
      if (tabId !== undefined) await chrome.storage.session.set({ [K.search(tabId)]: msg.snapshot });
      return null;
    }
    case "PUBLISH_RANKING": {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) await chrome.storage.session.set({ [K.rank(tabId)]: msg.entries });
      return null;
    }
    case "PROFILE_DETECTED": {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return null;
      const job = (await chrome.storage.local.get(K.activeJob))[K.activeJob] as ActiveJob | undefined;
      const cfg = (await chrome.storage.local.get(K.config))[K.config] as Config | undefined;
      if (!job || !cfg) return null; // panel shows "select a job"; user can re-trigger later
      await analyze(tabId, msg.rawText, msg.label, msg.url, job.id);
      return null;
    }
    case "CARD_CLICKED": {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return null;
      await chrome.storage.session.set({ [K.focus(tabId)]: { domId: msg.domId, ts: Date.now() } });
      // Opening the panel needs a user gesture; the pill click usually carries one. Best-effort.
      await chrome.sidePanel.open({ tabId }).catch(() => {});
      return null;
    }

    /* ── from side panel ── */
    case "CONNECT": {
      // Paste-the-key login. /me validates URL + key and tells us WHICH HR this is (older servers: fall back to /jobs).
      const me = await rawApi<{ user: NonNullable<Config["user"]> }>(msg.config, "/me", undefined, undefined, true).catch(async (e: Error) => {
        if (!/404|not found/i.test(e.message)) throw e;
        await rawApi(msg.config, "/jobs", undefined, undefined, true);
        return { user: undefined };
      });
      await adoptConfig({ ...msg.config, baseUrl: msg.config.baseUrl.replace(/\/+$/, ""), user: me.user });
      return me.user ?? null;
    }
    case "LOGIN": {
      // Email + password → this HR's own extension key. Nothing is shared between HRs.
      const base = msg.baseUrl.replace(/\/+$/, "");
      let res: Response;
      try {
        res = await fetch(`${base}/api/extension/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: msg.email, password: msg.password }) });
      } catch {
        throw new BgError(`Cannot reach ${base}. Is the server running and the URL correct?`);
      }
      const data = (await res.json().catch(() => ({}))) as { apiKey?: string; user?: Config["user"]; error?: string };
      if (!res.ok || !data.apiKey) throw new BgError(data.error ?? `Login failed (${res.status})`);
      await adoptConfig({ baseUrl: base, apiKey: data.apiKey, user: data.user });
      return data.user ?? null;
    }
    case "LOGOUT":
      await clearUserState();
      return null;
    case "GET_ANALYZED": {
      const job = await requireJob();
      const session = msg.scope === "search" && msg.tabId !== null ? await ensureSearchSession(msg.tabId, job.id).catch(() => null) : null;
      const q = new URLSearchParams({ jobId: job.id, minScore: String(msg.minScore ?? 0) });
      if (session) q.set("searchSessionId", session.id);
      const list = await api<AnalyzedList>(`/analyzed?${q}`);
      return { ...list, scope: session ? "search" : "job", session } satisfies AnalyzedList & { scope: string; session: SearchSessionInfo | null };
    }
    case "READ_PROFILE":
      return readProfile(msg.tabId);
    case "ATTACH_CV":
      return attachCv(msg.tabId);
    case "MAP_FORM":
      return toTab(msg.tabId, { type: "MAP_FORM" });
    case "SCORE_PENDING":
      return toTab(msg.tabId, { type: "SCORE_PENDING" });
    case "READ_SEARCH":
      return toTab(msg.tabId, { type: "READ_SEARCH" });
    case "GET_JOBS":
      return (await api<{ jobs: JobSummary[] }>("/jobs")).jobs;
    case "CREATE_ADHOC_JOB":
      return (await api<{ job: JobSummary }>("/jobs", { rawDescription: msg.rawDescription, title: msg.title }, "POST")).job;
    case "ANALYZE_TEXT": {
      const job = await requireJob();
      await analyze(msg.tabId, msg.rawText, msg.label, msg.url, job.id, true);
      return null;
    }
    case "SAVE_CANDIDATE":
      return saveCandidate(msg.tabId);
    case "FILL_SEARCH":
      // An older side panel (cached) sends `keywords` instead of `fields` — accept both.
      return fillSearch(msg.tabId, msg.fields ?? { booleanQuery: (msg as unknown as { keywords?: string }).keywords ?? "", minExp: null, maxExp: null, locations: [] });
    case "SAVE_CARDS":
      return enqueueSave(msg.tabId, msg.cards);
    case "FOCUS_CARD":
      return toTab(msg.tabId, { type: "FOCUS_CARD", domId: msg.domId });
    case "AGENT_TICK":
      void agent.tick().catch(() => {});
      return null;
    case "AGENT_CAPTURE":
      return agent.capture(msg.taskId, msg.page, msg.cards);
    case "AGENT_EVENT":
      await agent.event(msg.taskId, msg.kind, msg.message, msg.data ?? {});
      return null;
    case "AGENT_RUN_STATE":
      await agent.onRunState(msg.taskId, msg.state, msg.reason);
      return null;
    case "ENSURE_CONTENT":
      return ensureContent(msg.tabId);
  }
}

/* ───────────── backend proxy ───────────── */

class BgError extends Error {
  constructor(message: string, public code?: Reply["code"]) {
    super(message);
  }
}

async function getConfig(): Promise<Config> {
  const cfg = (await chrome.storage.local.get(K.config))[K.config] as Config | undefined;
  if (!cfg?.baseUrl || !cfg.apiKey) throw new BgError("Not connected — enter your Platform URL and API key.", "NOT_CONFIGURED");
  return cfg;
}

async function requireJob(): Promise<ActiveJob> {
  await getConfig();
  const job = (await chrome.storage.local.get(K.activeJob))[K.activeJob] as ActiveJob | undefined;
  if (!job) throw new BgError("Select an active job in the side panel first.", "NO_JOB");
  return job;
}

async function api<T>(path: string, body?: unknown, method?: "POST" | "GET" | "PATCH"): Promise<T> {
  return rawApi<T>(await getConfig(), path, body, method);
}

async function rawApi<T>(cfg: Config, path: string, body?: unknown, method?: "POST" | "GET" | "PATCH", validating = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/api/extension${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new BgError(`Cannot reach ${cfg.baseUrl}. Is the server running and the URL correct?`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !validating) {
    // The key was rotated / the HR was removed: drop everything tied to that HR so the next screen is the login form.
    await clearUserState();
    throw new BgError("Your session expired — please log in again.", "NOT_CONFIGURED");
  }
  if (!res.ok) throw new BgError((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/* ───────────── per-HR isolation of local state ───────────── */

/** Forget EVERYTHING tied to the logged-in HR: key, active job, query drafts, ranking/detail/search caches of every tab. */
async function clearUserState() {
  const all = await chrome.storage.local.get(null);
  const doomed = Object.keys(all).filter((k) => k === K.config || k === K.activeJob || k.startsWith("queryDraft:"));
  await chrome.storage.local.remove(doomed);
  await chrome.storage.session.clear();
  await stopScoring().catch(() => {});
}

/** Stores a new login. If it is a DIFFERENT HR (or server) than before, the previous HR's job/drafts/caches are wiped first. */
async function adoptConfig(next: Config) {
  const prev = (await chrome.storage.local.get(K.config))[K.config] as Config | undefined;
  const sameHr = !!prev && prev.baseUrl === next.baseUrl && (prev.user?.id ?? prev.apiKey) === (next.user?.id ?? next.apiKey);
  if (prev && !sameHr) await clearUserState();
  await chrome.storage.local.set({ [K.config]: next });
}

/* ───────────── Naukri search sessions ───────────── */

const inflightSessions = new Map<string, Promise<SearchSessionInfo | null>>();

/**
 * The server-side search session for the search that produced the cards on this tab (created lazily, de-duplicated per
 * tab+job+signature). Changing any keyword / filter on Naukri yields a new signature → a new session; the old one's analyzed list is kept.
 */
function ensureSearchSession(tabId: number, jobId: string): Promise<SearchSessionInfo | null> {
  const run = async (): Promise<SearchSessionInfo | null> => {
    const snap = (await chrome.storage.session.get(K.search(tabId)))[K.search(tabId)] as SearchSnapshot | undefined;
    if (!snap) return null;
    const cur = (await chrome.storage.session.get(K.searchSession(tabId)))[K.searchSession(tabId)] as SearchSessionInfo | undefined;
    if (cur && cur.sig === snap.appliedSig && cur.jobId === jobId) return cur;
    const r = await api<{ session: { id: string; label: string; analyzedCount: number } }>("/search-session", { jobId, signature: snap.appliedSig, state: snap.applied });
    const info: SearchSessionInfo = { id: r.session.id, sig: snap.appliedSig, jobId, label: r.session.label, analyzedCount: r.session.analyzedCount };
    await chrome.storage.session.set({ [K.searchSession(tabId)]: info });
    return info;
  };
  // share one request between the several SCORE_CARDS chunks that start together
  return (async () => {
    const snap = (await chrome.storage.session.get(K.search(tabId)))[K.search(tabId)] as SearchSnapshot | undefined;
    const key = `${tabId}|${jobId}|${snap?.appliedSig ?? ""}`;
    let p = inflightSessions.get(key);
    if (!p) {
      p = run().finally(() => inflightSessions.delete(key));
      inflightSessions.set(key, p);
    }
    return p;
  })();
}

/* ───────────── deep audit + save ───────────── */

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function analyze(tabId: number, rawText: string, label: string, url: string, jobId: string, force = false) {
  const key = hash(`${jobId}|${url}|${rawText}`);
  const existing = (await chrome.storage.session.get(K.detail(tabId)))[K.detail(tabId)] as DetailState | undefined;
  if (!force && existing?.key === key && existing.status !== "error") return; // already audited / in flight

  const base: DetailState = { key, status: "loading", label, url, rawText, jobId };
  await chrome.storage.session.set({ [K.detail(tabId)]: base });
  try {
    const { audit } = await api<{ audit: Audit }>("/score-profile", { jobId, rawText, profileUrl: url });
    await chrome.storage.session.set({ [K.detail(tabId)]: { ...base, status: "ready", audit } satisfies DetailState });
  } catch (e) {
    await chrome.storage.session.set({ [K.detail(tabId)]: { ...base, status: "error", error: (e as Error).message } satisfies DetailState });
  }
}

async function saveCandidate(tabId: number) {
  const st = (await chrome.storage.session.get(K.detail(tabId)))[K.detail(tabId)] as DetailState | undefined;
  if (!st?.audit) throw new BgError("Nothing to save yet — wait for the AI audit.");
  const put = (save: DetailState["save"]) => chrome.storage.session.set({ [K.detail(tabId)]: { ...st, save } });
  await put({ status: "saving" });
  try {
    // Re-read the OPEN profile now: a mobile number revealed after the audit ran is only in the text from this moment on.
    const live = await readProfile(tabId).catch(() => null);
    const rawText = live?.open && live.rawText.length > 300 ? live.rawText : st.rawText;
    const r = await api<{ duplicate: boolean; webUrl: string; candidate: { id: string }; contact?: { phone: string | null; email: string | null; phoneMasked: boolean } }>("/import-candidate", {
      jobId: st.jobId,
      profileUrl: st.url,
      rawText,
      audit: stripTier(st.audit),
    });
    const cfg = await getConfig();
    await put({ status: "saved", duplicate: r.duplicate, webUrl: `${cfg.baseUrl.replace(/\/+$/, "")}${r.webUrl}`, candidateId: r.candidate.id, contact: r.contact, cv: { status: live?.cvLinks.length ? "idle" : "none" } });
    return null;
  } catch (e) {
    await put({ status: "error", error: (e as Error).message });
    throw e;
  }
}

/** Fresh snapshot of the open profile (text, phone/e-mail, CV links). */
async function readProfile(tabId: number): Promise<ProfileSnapshot> {
  if (!(await ensureContent(tabId))) throw new BgError("Couldn't reach the Resdex tab. Refresh the page (F5) and try again.");
  const r = (await chrome.tabs.sendMessage(tabId, { type: "READ_PROFILE" } satisfies BgToContent).catch(() => null)) as ProfileSnapshot | null;
  if (!r) throw new BgError("This Resdex tab is running an old copy of the extension. Refresh the page (F5).");
  return r;
}

/**
 * "Attach CV" — runs only when the recruiter presses the button. The content script downloads the CV through the recruiter's own
 * Resdex session (what clicking the link does); the file is then stored on the platform against the saved candidate, and any phone/e-mail
 * printed inside it completes the profile.
 */
async function attachCv(tabId: number) {
  const st = (await chrome.storage.session.get(K.detail(tabId)))[K.detail(tabId)] as DetailState | undefined;
  const candidateId = st?.save?.candidateId;
  if (!st || !candidateId) throw new BgError("Save the candidate first, then attach the CV.");
  const setCv = (cv: NonNullable<DetailState["save"]>["cv"], extra: Partial<NonNullable<DetailState["save"]>> = {}) => chrome.storage.session.set({ [K.detail(tabId)]: { ...st, save: { ...st.save!, ...extra, cv } } });
  await setCv({ status: "fetching" });
  try {
    const prof = await readProfile(tabId);
    const link = prof.cvLinks[0];
    if (!link) {
      await setCv({ status: "none" });
      throw new BgError("No CV download link is visible on this profile.");
    }
    const got = (await chrome.tabs.sendMessage(tabId, { type: "FETCH_CV", href: link.href } satisfies BgToContent)) as { ok: boolean; error?: string; name?: string; mime?: string; base64?: string };
    if (!got?.ok || !got.base64) throw new BgError(got?.error ?? "Couldn't download the CV");
    const bytes = Uint8Array.from(atob(got.base64), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append("file", new File([bytes], got.name ?? "cv.pdf", { type: got.mime }));
    const cfg = await getConfig();
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/api/extension/candidates/${candidateId}/resume`, { method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: fd });
    const data = (await res.json().catch(() => ({}))) as { error?: string; phone?: string | null; email?: string | null; phoneFromCv?: boolean; resume?: { fileName: string } };
    if (!res.ok) throw new BgError(data.error ?? `Upload failed (${res.status})`);
    await setCv(
      { status: "saved", fileName: data.resume?.fileName ?? got.name, phoneFromCv: data.phoneFromCv },
      { contact: { phone: data.phone ?? st.save?.contact?.phone ?? null, email: data.email ?? st.save?.contact?.email ?? null, phoneMasked: false } },
    );
    return null;
  } catch (e) {
    const cur = (await chrome.storage.session.get(K.detail(tabId)))[K.detail(tabId)] as DetailState | undefined;
    if (cur?.save?.cv?.status !== "none") await chrome.storage.session.set({ [K.detail(tabId)]: { ...cur, save: { ...cur?.save, cv: { status: "error", error: (e as Error).message } } } });
    throw e;
  }
}

/* ───────────── card-level shortlist (no profile opened → no CV-view quota used) ─────────────
 * Runs ONLY from an explicit click on "Save Card" / "Save All High-Priority" in the side panel. Cards are posted one at a
 * time (no LLM call server-side, so it is fast) and the outcome of each is written to session storage for the panel. */

let saveChain: Promise<unknown> = Promise.resolve(); // serialises overlapping clicks so storage read-modify-writes can't interleave

function enqueueSave(tabId: number, cards: CardSavePayload[]) {
  const run = saveChain.then(() => saveCards(tabId, cards));
  saveChain = run.catch(() => undefined);
  return run;
}

const known = (n: number | undefined) => (typeof n === "number" && n >= 0 ? n : null);

async function saveCards(tabId: number, cards: CardSavePayload[]): Promise<{ saved: number; failed: number }> {
  const job = await requireJob();
  const key = K.saved(tabId);
  const map: SaveMap = ((await chrome.storage.session.get(key))[key] as SaveMap | undefined) ?? {};
  const flush = () => chrome.storage.session.set({ [key]: map });
  let saved = 0;
  let failed = 0;

  for (const c of cards) if (map[c.key]?.status !== "saved") map[c.key] = { status: "saving" };
  await flush();

  for (const c of cards) {
    if (map[c.key]?.status === "saved") continue;
    const r = c.result;
    const x = r.extracted;
    // Never save a result that describes someone else (the scorer once returned one candidate's details for several cards).
    if (!resultMatchesCard(x, c.rawText)) {
      map[c.key] = { status: "error", error: "This card's AI result does not match the candidate on screen. Press Start to re-score it, then save." };
      failed++;
      await flush();
      continue;
    }
    try {
      const res = await api<{ duplicate: boolean; keptFullProfile?: boolean }>("/import-candidate", {
        jobId: job.id,
        card: {
          fullName: x?.fullName || c.label,
          currentRole: x?.currentRole ?? "",
          currentCompany: x?.currentCompany ?? "",
          totalExp: known(x?.expYears),
          currentCtc: known(x?.currentCtcLpa),
          expectedCtc: known(x?.expectedCtcLpa),
          noticePeriod: r.noticePeriod === "Not mentioned" ? "" : r.noticePeriod,
          location: x?.location ?? "",
          naukriProfileUrl: c.profileUrl,
          rawProfileText: c.rawText.slice(0, 2500),
          aiScore: r.score,
          matchedSkills: r.matchedSkills,
          missingSkills: r.missingSkills,
          verdict: r.oneLineVerdict,
        },
      });
      map[c.key] = { status: "saved", duplicate: res.duplicate, keptFullProfile: res.keptFullProfile };
      saved++;
    } catch (e) {
      map[c.key] = { status: "error", error: (e as Error).message };
      failed++;
    }
    await flush();
  }
  return { saved, failed };
}

/** Server's AuditZ has no `tier` key (it's recomputed server-side). */
function stripTier(a: Audit) {
  const { tier: _tier, ...rest } = a;
  void _tier;
  return rest;
}

/* ───────────── tab messaging ───────────── */

/** A content script already sitting in an open tab survives extension reloads and can be an OLD copy → detect it by version. */
async function fillSearch(tabId: number, fields: import("../shared/types").SearchFill) {
  if (!(await ensureContent(tabId))) throw new BgError("Couldn't reach the Resdex tab. Refresh the page (F5) and try again.");
  const pong = (await chrome.tabs.sendMessage(tabId, { type: "PING" } satisfies BgToContent).catch(() => null)) as { v?: number } | null;
  if (!pong || (pong.v ?? 0) < 4) throw new BgError("This Resdex tab is still running an old copy of the extension. Refresh the page (F5), then click Fill again.");
  return chrome.tabs.sendMessage(tabId, { type: "FILL_RESDEX_SEARCH", fields } satisfies BgToContent);
}

async function toTab(tabId: number, msg: BgToContent) {
  await ensureContent(tabId);
  return chrome.tabs.sendMessage(tabId, msg);
}

async function ensureContent(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" } satisfies BgToContent);
    return true;
  } catch {
    return injectContent(tabId);
  }
}

async function injectContent(tabId: number) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js", "agent.js"] });
    return true;
  } catch {
    return false; // not a Resdex tab / no host permission
  }
}

export type { RankEntry };
