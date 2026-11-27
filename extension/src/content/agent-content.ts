/**
 * Sourcing agent, page side. Runs inside the Resdex tab the recruiter is already logged into and works only through what that page
 * shows: it reads result cards, clicks the pagination control, and reads form values back. It does NOT open profiles, use an
 * API, read cookies or tokens, or send anything to Naukri beyond the clicks a person would make on the results pager.
 *
 * Everything that must survive a page reload / worker restart lives in chrome.storage.local under "agent.run".
 */
import type { AgentRun as Run, AgentRunState, FieldStatus, FieldVerdict, SearchFill } from "../shared/types";
import { cardLink, cleanText, findCards, hashStr } from "./cards";
import { describe, formFields, PILL_HOST_ATTR } from "./formFields";
import { readSearchState } from "./searchState";

declare global {
  interface Window {
    __xsHuntAgent?: boolean;
  }
}

const AGENT_VERSION = 1;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const txt = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const norm = (s: string) => s.toLowerCase().replace(/["'()\s]+/g, "");

/* ───────────────────────────── session state (what the page SHOWS) ───────────────────────────── */

export type SessionState = "signed_in" | "signed_out" | "captcha" | "expired" | "unknown";

/** Pure decision from page facts, so it can be tested without a browser. */
export function decideSession(f: { url: string; text: string; hasPassword: boolean; hasCaptchaFrame: boolean; hasSearchUi: boolean; cardCount: number }): SessionState {
  const text = f.text.toLowerCase();
  if (f.hasCaptchaFrame || /captcha|verify (that )?you are (a )?human|unusual traffic|are you a robot/.test(text)) return "captcha";
  if (/session (has )?expired|logged out|log ?ged in (from|on) another|please login again|your session/.test(text)) return "expired";
  if (/\/(login|sign-?in|authenticate)\b/i.test(new URL(f.url, "https://resdex.naukri.com").pathname) || (f.hasPassword && !f.hasSearchUi && f.cardCount === 0)) return "signed_out";
  if (f.hasSearchUi || f.cardCount > 0) return "signed_in";
  return "unknown";
}

export function detectSession(): SessionState {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input")].filter((i) => !i.closest(`[${PILL_HOST_ATTR}]`));
  const hasSearchUi = inputs.some((i) => /keyword|skill|designation|boolean|search/i.test(`${i.placeholder} ${i.getAttribute("aria-label") ?? ""} ${i.name}`) && i.type !== "password");
  return decideSession({
    url: location.href,
    text: document.body?.innerText?.slice(0, 4000) ?? "",
    hasPassword: inputs.some((i) => i.type === "password"),
    hasCaptchaFrame: !!document.querySelector('iframe[src*="captcha" i],iframe[src*="recaptcha" i],[class*="captcha" i]'),
    hasSearchUi,
    cardCount: findCards().length,
  });
}

/* ───────────────────────────── cards + pagination ───────────────────────────── */

export interface PageCard {
  position: number;
  rawText: string;
  profileUrl: string | null;
  cardKey: string;
}

export function readCardsNow(): PageCard[] {
  return findCards().map((el, position) => {
    const rawText = cleanText(el, 2500);
    const profileUrl = cardLink(el) ?? null;
    return { position, rawText, profileUrl, cardKey: `c_${hashStr(`${profileUrl ?? ""}|${rawText.slice(0, 400)}`)}` };
  });
}

/** Cards, once the list has stopped changing (Resdex renders results progressively). */
async function readCardsStable(timeoutMs = 12_000): Promise<PageCard[]> {
  const start = Date.now();
  let last = "";
  let stableSince = Date.now();
  let cards: PageCard[] = [];
  while (Date.now() - start < timeoutMs) {
    cards = readCardsNow();
    const sig = cards.map((c) => c.cardKey).join(",");
    if (sig !== last) {
      last = sig;
      stableSince = Date.now();
    } else if (cards.length > 0 && Date.now() - stableSince > 900) return cards;
    await sleep(300);
  }
  return cards;
}

const NEXT_TEXT = /^(next|next page|›|»|>|→)$/i;
const shown = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const disabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled") || /\b(disabled|inactive)\b/i.test(el.className?.toString() ?? "");

export function currentPageNumber(): number | null {
  const fromUrl = new URL(location.href).searchParams;
  for (const key of ["page", "pageNo", "pageno", "pg", "p"]) {
    const v = Number(fromUrl.get(key));
    if (Number.isInteger(v) && v > 0) return v;
  }
  const active = document.querySelector<HTMLElement>('[aria-current="page"],[class*="pagination" i] [class*="active" i],[class*="pager" i] [class*="active" i],[class*="pagination" i] [class*="selected" i]');
  const n = Number(txt(active?.textContent));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The pager's "next" control. Never something inside a candidate card. */
export function findNextControl(): HTMLElement | null {
  const cardEls = findCards();
  const candidates = [...document.querySelectorAll<HTMLElement>('a,button,li,span,div[role="button"],[role="link"]')].filter((el) => {
    if (el.closest(`[${PILL_HOST_ATTR}]`) || cardEls.some((c) => c.contains(el)) || !shown(el)) return false;
    return NEXT_TEXT.test(txt(el.textContent)) || /\bnext\b/i.test(`${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`);
  });
  // prefer the innermost element that is not disabled
  const ok = candidates.filter((el) => !disabled(el) && !(el.closest("li") && disabled(el.closest("li") as HTMLElement)));
  if (ok.length) return ok.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0] ?? null;
  const page = currentPageNumber();
  if (page !== null) {
    const link = [...document.querySelectorAll<HTMLElement>("a,button,li,span")].find((el) => !cardEls.some((c) => c.contains(el)) && shown(el) && txt(el.textContent) === String(page + 1) && /pagin|pager|page/i.test(el.closest("[class]")?.className?.toString() ?? ""));
    if (link && !disabled(link)) return link;
  }
  return null;
}

/* ───────────────────────────── filter read-back ───────────────────────────── */

const UNMAPPED: Record<string, string> = {
  previousDesignation: "Previous designation",
  preferredLocation: "Preferred location",
  currentCompany: "Current company",
  industry: "Industry",
  expectedMinSalary: "Expected CTC (min)",
  expectedMaxSalary: "Expected CTC (max)",
  university: "University",
};

const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : v !== null && v !== undefined);

/**
 * Reads the Resdex form back and compares it with what was asked for. A field is "applied" ONLY when the page really shows the value.
 * `filled` is what the fill routine claimed per key (filled / manual / missing); it can lower a verdict but never raise one.
 */
export function verifyFilters(fill: SearchFill, filled: Record<string, "filled" | "manual" | "missing"> = {}): Record<string, FieldVerdict> {
  const live = readSearchState();
  const fields = formFields();
  const out: Record<string, FieldVerdict> = {};
  const set = (key: string, status: FieldStatus, detail?: string) => (out[key] = { status, ...(detail ? { detail } : {}) });
  const lowKw = [...live.keywords.split(/[,;]+/), ...live.anyKeywords, ...live.excludeKeywords].map((k) => norm(k));
  const fieldValue = (re: RegExp) => fields.find(({ d }) => re.test(d))?.el;
  const val = (el: Element | undefined) => (el instanceof HTMLSelectElement ? txt(el.selectedOptions[0]?.textContent) : el ? txt((el as HTMLInputElement).value) : "");

  const verdictFor = (key: string, ok: boolean, shown: string, expected: string) => {
    const claim = filled[key];
    if (claim === "missing") return set(key, "unsupported", "This Resdex page has no field for it");
    if (claim === "manual") return set(key, "attention", "Needs a manual pick on Naukri (suggestion list or chip picker)");
    ok ? set(key, "applied", `Naukri shows: ${shown || expected}`) : set(key, "failed", `Expected "${expected}", Naukri shows "${shown || "nothing"}"`);
  };

  if (has(fill.booleanQuery)) {
    const shown = live.keywords;
    const ok = norm(shown) === norm(fill.booleanQuery) || norm(shown).includes(norm(fill.booleanQuery));
    verdictFor("boolean", ok, shown, fill.booleanQuery);
  }
  for (const [key, list] of [["keywords", fill.allKeywords], ["anyKeywords", fill.anyKeywords], ["excludeKeywords", fill.excludeKeywords]] as const) {
    if (!has(list)) continue;
    const missing = (list ?? []).filter((k) => !lowKw.some((s) => s.includes(norm(k))));
    // In Boolean mode all keywords live inside the single Boolean query; accept them there.
    const inBoolean = !!fill.booleanQuery && (list ?? []).every((k) => norm(live.keywords).includes(norm(k)));
    verdictFor(key, missing.length === 0 || inBoolean, (list ?? []).filter((k) => !missing.includes(k)).join(", "), (list ?? []).join(", "));
  }
  if (has(fill.designations)) {
    const shown = val(fieldValue(/designation|job title|role/));
    verdictFor("designation", (fill.designations ?? []).some((d) => norm(shown).includes(norm(d))), shown, (fill.designations ?? [])[0] ?? "");
  }
  if (fill.minExp !== null && fill.minExp !== undefined) verdictFor("minExp", live.minExp === fill.minExp, String(live.minExp ?? ""), String(fill.minExp));
  if (fill.maxExp !== null && fill.maxExp !== undefined) verdictFor("maxExp", live.maxExp === fill.maxExp, String(live.maxExp ?? ""), String(fill.maxExp));
  if (has(fill.locations)) {
    const first = (fill.locations ?? [])[0] ?? "";
    verdictFor("location", norm(live.location).includes(norm(first)), live.location, first);
  }
  if (fill.minSalary !== null && fill.minSalary !== undefined) verdictFor("minSalary", live.minSalary === fill.minSalary, String(live.minSalary ?? ""), String(fill.minSalary));
  if (fill.maxSalary !== null && fill.maxSalary !== undefined) verdictFor("maxSalary", live.maxSalary === fill.maxSalary, String(live.maxSalary ?? ""), String(fill.maxSalary));
  if (fill.maxNoticeDays !== null && fill.maxNoticeDays !== undefined) {
    const f = live.filters.find((x) => /notice/i.test(x.label));
    const sel = fields.find(({ el, d }) => el instanceof HTMLSelectElement && /notice/.test(d));
    const shown = f?.value ?? (sel ? val(sel.el) : "");
    verdictFor("notice", !!shown && !(claimOf(filled, "notice") === "missing"), shown, `<= ${fill.maxNoticeDays} days`);
  }
  if (has(fill.education)) {
    const f = live.filters.find((x) => /education|qualification/i.test(x.label));
    const shown = f?.value ?? val(fieldValue(/education|qualification/));
    verdictFor("education", norm(shown).includes(norm(fill.education ?? "")), shown, fill.education ?? "");
  }
  // Filters the extension has no mapping for are reported as such, never as applied.
  for (const [key, label] of Object.entries(UNMAPPED)) if (has((fill as unknown as Record<string, unknown>)[key])) set(key, "unsupported", `${label}: not mapped to the Resdex form in this version. Set it on Naukri manually.`);
  return out;
}
const claimOf = (filled: Record<string, string>, key: string) => filled[key];

/* ───────────────────────────── the sourcing run ───────────────────────────── */

const RUN_KEY = "agent.run";
const getRun = async () => ((await chrome.storage.local.get(RUN_KEY))[RUN_KEY] as Run | undefined) ?? null;
const putRun = (run: Run) => chrome.storage.local.set({ [RUN_KEY]: run });

function send<T = unknown>(msg: Record<string, unknown>): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError || !r ? { ok: false, error: chrome.runtime.lastError?.message ?? "No response" } : r));
    } catch {
      resolve({ ok: false, error: "Extension context invalidated" });
    }
  });
}
const event = (taskId: string, kind: "progress" | "page" | "warning" | "error" | "info" | "session", message: string, data: Record<string, unknown> = {}) => send({ type: "AGENT_EVENT", taskId, kind, message, data });

let running = false;

/** Waits `ms`, but wakes every second to notice Pause / Stop. Returns false when the run is no longer "running". */
async function politeWait(taskId: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(Math.min(1000, end - Date.now()));
    const r = await getRun();
    if (!r || r.taskId !== taskId || r.state !== "running") return false;
  }
  return true;
}

export async function runSourcing(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const run = await getRun();
      if (!run || run.state === "stopped" || run.state === "completed") return;
      if (run.state === "paused") {
        await sleep(1000);
        continue;
      }
      const session = detectSession();
      if (session !== "signed_in") {
        run.state = "paused";
        await putRun(run);
        await event(run.taskId, "session", `Paused: Naukri shows "${session.replace("_", " ")}". Sign in (or solve the check yourself) and resume.`, { session });
        await send({ type: "AGENT_RUN_STATE", taskId: run.taskId, state: "paused", reason: session });
        return;
      }

      const cards = await readCardsStable();
      if (cards.length === 0) {
        run.state = "completed";
        await putRun(run);
        await event(run.taskId, "info", "No candidate cards on this page: nothing more to read.");
        await send({ type: "AGENT_RUN_STATE", taskId: run.taskId, state: "completed" });
        return;
      }
      const sig = cards.map((c) => c.cardKey).join(",");
      let limitReached = false;
      if (sig !== run.lastSig) {
        const pageNo = currentPageNumber() ?? run.page;
        const res = await send<{ captured: number; limitReached: boolean }>({ type: "AGENT_CAPTURE", taskId: run.taskId, page: pageNo, cards });
        if (!res.ok) {
          await event(run.taskId, "warning", `Page ${pageNo} could not be delivered yet (${res.error}). It stays queued and is retried.`);
        }
        run.lastSig = sig;
        run.pagesDone += 1;
        run.captured += res.data?.captured ?? 0;
        limitReached = !!res.data?.limitReached;
        await putRun(run);
        await event(run.taskId, "page", `Page ${pageNo}: ${cards.length} cards read, ${res.data?.captured ?? 0} new`, { page: pageNo, cards: cards.length, captured: res.data?.captured ?? 0 });
      }

      const fresh = await getRun();
      if (!fresh || fresh.state !== "running") continue; // paused / stopped while reading
      if (limitReached || run.pagesDone >= run.limits.maxPages || run.captured >= run.limits.maxCandidates) {
        run.state = "completed";
        await putRun(run);
        await event(run.taskId, "info", "Stopped at the configured limit.");
        await send({ type: "AGENT_RUN_STATE", taskId: run.taskId, state: "completed" });
        return;
      }

      const next = findNextControl();
      if (!next) {
        run.state = "completed";
        await putRun(run);
        await event(run.taskId, "info", "That was the last page of results.");
        await send({ type: "AGENT_RUN_STATE", taskId: run.taskId, state: "completed" });
        return;
      }
      // Pause like a person reading a page before moving on.
      const delay = run.limits.delaySeconds * 1000 * (0.8 + Math.random() * 0.6);
      if (!(await politeWait(run.taskId, delay))) continue;
      const before = sig;
      next.click();
      run.page += 1;
      await putRun(run);
      // wait for the list to change
      const started = Date.now();
      let changed = false;
      while (Date.now() - started < 20_000) {
        await sleep(500);
        const s = readCardsNow().map((c) => c.cardKey).join(",");
        if (s && s !== before) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        run.state = "paused";
        await putRun(run);
        await event(run.taskId, "error", "The results did not change after pressing Next. Paused so nothing is read twice.");
        await send({ type: "AGENT_RUN_STATE", taskId: run.taskId, state: "paused", reason: "page_did_not_change" });
        return;
      }
    }
  } finally {
    running = false;
  }
}

/* ───────────────────────────── messages ───────────────────────────── */

if (!window.__xsHuntAgent) {
  window.__xsHuntAgent = true;
  chrome.runtime.onMessage.addListener((msg: { type?: string; [k: string]: unknown }, _sender, sendResponse) => {
    switch (msg?.type) {
      case "AGENT_PING":
        sendResponse({ ok: true, v: AGENT_VERSION, running });
        break;
      case "AGENT_SESSION":
        sendResponse({ ok: true, session: detectSession(), url: location.href });
        break;
      case "AGENT_READ_CARDS":
        sendResponse({ ok: true, cards: readCardsNow(), page: currentPageNumber(), hasNext: !!findNextControl() });
        break;
      case "AGENT_VERIFY_FILTERS":
        sendResponse({ ok: true, fields: verifyFilters(msg.fill as SearchFill, (msg.filled as Record<string, "filled" | "manual" | "missing">) ?? {}) });
        break;
      case "AGENT_RUN":
        void runSourcing();
        sendResponse({ ok: true });
        break;
      default:
        return false;
    }
    return false;
  });
  // A page reload / SPA navigation in the middle of a run: pick the run up again.
  void (async () => {
    await sleep(1500);
    const run = await getRun();
    if (run?.state === "running") void runSourcing();
  })();
  // Heartbeat nudge: lets the (sleeping) service worker wake up and talk to the platform while a Resdex tab is open.
  setInterval(() => void send({ type: "AGENT_TICK" }), 5_000); // keeps the browser answering the platform quickly while a Resdex tab is open
  void send({ type: "AGENT_TICK" });
}
