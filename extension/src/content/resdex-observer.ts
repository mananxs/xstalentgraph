/**
 * Passive Resdex observer.
 *  - Only READS what is already rendered on screen (innerText of visible cards). No clicks, no pagination,
 *    no network requests to Naukri. The only DOM writes are our own score pills and (on explicit user
 *    request from the side panel) typing search values into the Resdex form via native setters + input/change
 *    events — never pressing Enter, never clicking Search, never opening a profile.
 *  - Card discovery is structural (text anchors: "N yrs" + salary/notice/location signals), not CSS-class based,
 *    so it survives Resdex's obfuscated/changing class names.
 */
import { DEFAULT_SETTINGS, K, WORTH_LABEL, worthOf, type BgToContent, type CardResult, type ContentToBg, type FillReport, type RankEntry, type Reply, type ProfileSnapshot, type SearchFill, type SearchState, type Settings } from "../shared/types";
import { PILL_HOST_ATTR } from "./formFields";
import { fillSearchFields, mapForm } from "./fillSearch";
import { extractContacts } from "../shared/contact";
import { resultMatchesCard } from "../shared/util";
import { readSearchState, searchSignature } from "./searchState";

declare global {
  interface Window {
    __resdexCopilot?: boolean;
  }
}

/** Bump when the message protocol changes; the service worker uses it to detect a stale copy left in an already-open tab. */
const CONTENT_VERSION = 4;

if (!window.__resdexCopilot) {
  window.__resdexCopilot = true;
  main();
}

function main() {
  /* ───────── constants / patterns ───────── */
  const CARD_MAX_CHARS = 2500;
  const PROFILE_MAX_CHARS = 9000;
  const DEBOUNCE_MS = 800;
  const RETRY_AFTER_MS = 15000;

  const EXP_RE = /\b\d{1,2}(?:\.\d)?\s*\+?\s*(?:yrs?|years?)\b/i;
  const SAL_RE = /(?:\blacs?\b|\blakhs?\b|\blpa\b|\bcr\b|₹|\brs\.?\s?\d)/i;
  const SIGNALS: RegExp[] = [
    /notice/i,
    /current|present|designation/i,
    /key\s*skills?|skills?|preferred|expertise/i,
    /bangalore|bengaluru|mumbai|delhi|ncr|gurgaon|gurugram|noida|pune|hyderabad|chennai|kolkata|ahmedabad|remote|india/i,
    /b\.?\s?tech|m\.?\s?tech|\bb\.?e\b|mba|mca|bca|b\.?\s?sc|m\.?\s?sc|graduat|diploma/i,
  ];
  const PROFILE_URL_RE = /(profile|viewcv|cvview|candidate|resume|\bcv\b)/i;

  /* ───────── state ───────── */
  let seq = 0;
  let blocked: string | null = null; // "NO_JOB" / "NOT_CONFIGURED" → stop until storage changes
  let running = false;
  let rerun = false;
  let debounceTimer: number | undefined;
  const entries = new Map<string, RankEntry & { el: HTMLElement; hash: string }>();
  const cache = new Map<string, CardResult>(); // text-hash → result (reused when SPA re-renders the same card)
  const failedAt = new Map<string, number>();
  let lastProfileSig = "";
  let settings: Settings = { ...DEFAULT_SETTINGS };
  /** Scoring only happens while the recruiter has pressed START and "Analyzed only" is off. */
  const scoringAllowed = () => settings.scoring && !settings.analyzedOnly;
  /** One-shot: "Score N new cards" while in Analyzed-only mode. */
  let forceScore = false;
  /** The search that produced the cards currently on screen (vs. the form as it is right now). */
  let applied: { state: SearchState; sig: string } | null = null;
  let prevCardHashes = new Set<string>();
  let lastLiveSig = "";
  let lastUrl = location.href;
  let searchTimer: number | undefined;

  /* ───────── messaging ───────── */
  function send<T = unknown>(msg: ContentToBg): Promise<Reply<T>> {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r: Reply<T> | undefined) => {
          if (chrome.runtime.lastError || !r) resolve({ ok: false, error: chrome.runtime.lastError?.message ?? "No response" });
          else resolve(r);
        });
      } catch {
        resolve({ ok: false, error: "Extension context invalidated — reload the page" });
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg: BgToContent, _sender, sendResponse) => {
    if (msg.type === "PING") {
      sendResponse({ ok: true, v: CONTENT_VERSION });
    } else if (msg.type === "FILL_RESDEX_SEARCH") {
      // Tolerate a legacy `{keywords}` payload instead of crashing on `undefined.minExp`.
      const legacy = (msg as unknown as { keywords?: string }).keywords;
      const fields: SearchFill | undefined = msg.fields ?? (legacy ? { booleanQuery: legacy, minExp: null, maxExp: null, locations: [] } : undefined);
      if (!fields) {
        sendResponse({ ok: false, error: "No search values received — reload the extension and try again.", filled: {}, fields: [], notes: [] });
        return false;
      }
      void fillSearchFields(fields).then(sendResponse); // async: toggling Boolean mode / notice options needs a short wait
      return true;
    } else if (msg.type === "MAP_FORM") {
      sendResponse(mapForm());
    } else if (msg.type === "READ_PROFILE") {
      sendResponse(readProfile());
    } else if (msg.type === "FETCH_CV") {
      void fetchCv(msg.href).then(sendResponse);
      return true;
    } else if (msg.type === "FOCUS_CARD") {
      sendResponse({ ok: focusCard(msg.domId) });
    } else if (msg.type === "URL_CHANGED") {
      onUrlChange();
      sendResponse({ ok: true });
    } else if (msg.type === "READ_SEARCH") {
      publishSearch(true);
      sendResponse({ ok: true });
    } else if (msg.type === "SCORE_PENDING") {
      forceScore = true;
      schedule(0);
      sendResponse({ ok: true });
    }
    return false; // all replies are synchronous
  });

  chrome.storage.local.get(K.settings).then((o) => {
    settings = { ...DEFAULT_SETTINGS, ...((o[K.settings] as Partial<Settings> | undefined) ?? {}) };
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[K.settings]) {
      const was = scoringAllowed();
      settings = { ...DEFAULT_SETTINGS, ...((changes[K.settings].newValue as Partial<Settings> | undefined) ?? {}) };
      if (was !== scoringAllowed()) {
        if (!scoringAllowed()) forceScore = false;
        schedule(0); // Start/Stop or mode switch re-evaluates the cards already on screen (no reset, no extra AI calls)
      }
    }
    // Re-score only when the job (or connection) actually changes — refreshing the same job's search fields must not
    // wipe pills and trigger a new round of scoring calls.
    const idSig = (v: unknown) => {
      const j = v as { id?: string; sig?: string } | undefined;
      return `${j?.id ?? ""}|${j?.sig ?? ""}`; // sig = hash of the rubric → an edited job re-scores, a mere field refresh does not
    };
    const jobChanged = changes.activeJob && idSig(changes.activeJob.oldValue) !== idSig(changes.activeJob.newValue);
    if (jobChanged || changes.config) {
      resetAll();
      schedule(0);
      if (changes.config) {
        lastLiveSig = "";
        lastAppliedSig = "";
        scheduleSearchRead(300); // a new login needs a fresh search snapshot (none is kept while logged out)
      }
    }
  });

  /* ───────── text helpers ───────── */
  function cleanText(el: HTMLElement, max: number): string {
    const raw = el.innerText || "";
    return raw
      .replace(/[ \t ]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim()
      .slice(0, max);
  }

  function hashStr(s: string) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function labelOf(text: string): string {
    const line = text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length >= 3 && l.length <= 60 && /[a-z]/i.test(l) && !EXP_RE.test(l) && !SAL_RE.test(l));
    return line ?? "Candidate";
  }

  /** Read-only: the card's own profile link (if any). We never click, open or fetch it. */
  function cardLink(el: HTMLElement): string | undefined {
    for (const a of el.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (a.closest(`[${PILL_HOST_ATTR}]`)) continue;
      try {
        const u = new URL(a.href, location.href);
        if (u.origin === location.origin && PROFILE_URL_RE.test(u.pathname + u.search)) return u.href;
      } catch {
        /* ignore malformed href */
      }
    }
    return undefined;
  }

  function visible(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 20;
  }

  /* ───────── structural card discovery ───────── */
  function looksLikeCard(el: HTMLElement): boolean {
    const t = el.innerText;
    if (!t || t.length < 250 || t.length > 6000) return false;
    if (!EXP_RE.test(t)) return false;
    if (!SAL_RE.test(t) && !/notice/i.test(t)) return false;
    let n = 0;
    for (const s of SIGNALS) if (s.test(t)) n++;
    return n >= 2;
  }

  function findCards(): HTMLElement[] {
    if (!document.body) return [];
    const minimal = new Set<HTMLElement>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || p.closest(`script,style,noscript,[${PILL_HOST_ATTR}]`)) return NodeFilter.FILTER_REJECT;
        return EXP_RE.test(n.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let el = n.parentElement;
      for (let depth = 0; el && el !== document.body && depth < 14; depth++, el = el.parentElement) {
        if (looksLikeCard(el)) {
          minimal.add(el);
          break;
        }
      }
    }
    // Keep outermost when nested (the inner one is a fragment of the real card).
    const arr = [...minimal];
    const outer = arr.filter((a) => !arr.some((b) => b !== a && b.contains(a)));
    // Grow each minimal match upward while its parent still contains exactly one match (captures name/header rows).
    const set = new Set(outer);
    const grown = new Set<HTMLElement>();
    for (const m of outer) {
      let cur = m;
      for (let i = 0; i < 4; i++) {
        const p = cur.parentElement;
        if (!p || p === document.body) break;
        let count = 0;
        for (const o of set) if (p.contains(o)) count++;
        if (count !== 1 || (p.innerText?.length ?? 0) > 6000) break;
        cur = p;
      }
      if (visible(cur)) grown.add(cur);
    }
    return [...grown];
  }

  /* ───────── profile (detail) extraction ───────── */
  function detectProfile(cardCount: number): { url: string; rawText: string; label: string } | null {
    const dlg = [...document.querySelectorAll<HTMLElement>('[role="dialog"],[aria-modal="true"]')].find(
      (d) => visible(d) && (d.innerText?.length ?? 0) > 500 && EXP_RE.test(d.innerText),
    );
    let source: HTMLElement | null = dlg ?? null;
    if (!source && PROFILE_URL_RE.test(location.pathname + location.hash) && cardCount <= 1) {
      source = document.querySelector<HTMLElement>("main") ?? document.body;
    }
    if (!source) return null;
    const rawText = cleanText(source, PROFILE_MAX_CHARS);
    if (rawText.length < 300 || !EXP_RE.test(rawText)) return null;
    return { url: location.href, rawText, label: labelOf(rawText) };
  }

  /* ───────── profile contact + CV (read at the moment the recruiter acts) ───────── */
  const CV_LINK_RE = /(download|view|get)[^a-z]{0,6}(cv|resume|résumé)|\b(cv|resume)\b[^a-z]{0,6}download|\.(pdf|docx?)(\?|#|$)/i;

  /** Fresh read of the OPEN profile: text, phone(s)/e-mail (a number revealed after the first read is picked up), CV download links. */
  function readProfile(): ProfileSnapshot {
    const prof = detectProfile(findCards().length);
    if (!prof) return { open: false, url: location.href, rawText: "", phones: [], emails: [], phoneMasked: false, cvLinks: [] };
    const c = extractContacts(prof.rawText);
    const dlg = [...document.querySelectorAll<HTMLElement>('[role="dialog"],[aria-modal="true"]')].find((d) => visible(d) && EXP_RE.test(d.innerText));
    const scope: ParentNode = dlg ?? document.querySelector("main") ?? document.body;
    const seen = new Set<string>();
    const cvLinks: ProfileSnapshot["cvLinks"] = [];
    for (const a of scope.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (a.closest(`[${PILL_HOST_ATTR}]`)) continue;
      const label = (a.innerText || a.getAttribute("aria-label") || a.title || "").replace(/\s+/g, " ").trim();
      try {
        const u = new URL(a.href, location.href);
        if (!/(^|\.)naukri\.com$/i.test(u.hostname) || seen.has(u.href)) continue;
        if (CV_LINK_RE.test(label) || CV_LINK_RE.test(u.pathname + u.search)) {
          seen.add(u.href);
          cvLinks.push({ href: u.href, label: label.slice(0, 60) || "CV" });
        }
      } catch {
        /* ignore malformed href */
      }
    }
    return { open: true, url: prof.url, rawText: prof.rawText, phones: c.phones, emails: c.emails, phoneMasked: c.phoneMasked, cvLinks: cvLinks.slice(0, 4) };
  }

  /**
   * "Attach CV" (recruiter pressed the button): downloads the CV through the recruiter's own logged-in session — exactly what
   * clicking the link does — and hands the bytes to the extension. naukri.com hosts only, ≤ 4 MB, PDF/DOCX only.
   */
  async function fetchCv(href: string): Promise<{ ok: boolean; error?: string; name?: string; mime?: string; base64?: string }> {
    try {
      const u = new URL(href, location.href);
      if (!/(^|\.)naukri\.com$/i.test(u.hostname) || u.protocol !== "https:") return { ok: false, error: "Only naukri.com CV links can be fetched" };
      const res = await fetch(u.href, { credentials: "include" });
      if (!res.ok) return { ok: false, error: `Resdex answered ${res.status} — the CV may need a download credit or the link expired` };
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 4 * 1024 * 1024) return { ok: false, error: "CV is larger than 4 MB" };
      const head = new Uint8Array(buf.slice(0, 4));
      const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
      const isZip = head[0] === 0x50 && head[1] === 0x4b; // PK → docx
      if (!isPdf && !isZip) return { ok: false, error: "That link did not return a PDF or DOCX file" };
      const cd = res.headers.get("content-disposition") ?? "";
      const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1];
      const name = decodeURIComponent(fromHeader ?? u.pathname.split("/").pop() ?? "cv") .replace(/[^\w.\- ]+/g, "_");
      const ext = isPdf ? ".pdf" : ".docx";
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { ok: true, name: /\.(pdf|docx)$/i.test(name) ? name : `${name}${ext}`, mime: isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", base64: btoa(bin) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /* ───────── pill (Shadow DOM) ───────── */
  const PILL_CSS = `
    :host{all:initial;position:absolute;top:8px;right:8px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
    button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;line-height:1.2;color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);white-space:nowrap}
    button:hover{filter:brightness(1.08)}
    .open{background:#059669}.review{background:#d97706}.skip{background:#64748b}.pending{background:#64748b}.err{background:#475569}.unscored{background:#fff;color:#475569;box-shadow:0 0 0 1.5px #94a3b8 inset}
    .tier{font-weight:600;opacity:.95;padding-left:6px;border-left:1px solid rgba(255,255,255,.55)}
    .dot{width:6px;height:6px;border-radius:50%;background:#fff;opacity:.9}
    .pending .dot{animation:p 1s infinite}@keyframes p{50%{opacity:.2}}
  `;

  function renderPill(entry: RankEntry & { el: HTMLElement }) {
    let host = entry.el.querySelector<HTMLElement>(`:scope > [${PILL_HOST_ATTR}]`);
    // A pill host that lost its button (the page cloned/serialised our DOM, or an SPA re-hydrated the card) can't be reused.
    if (host && !(host as HTMLElement & { _btn?: HTMLButtonElement })._btn) {
      host.remove();
      host = null;
    }
    if (!host) {
      host = document.createElement("div");
      host.setAttribute(PILL_HOST_ATTR, "true");
      const root = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = PILL_CSS;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void send({ type: "CARD_CLICKED", domId: entry.domId });
      });
      root.append(style, btn);
      (host as HTMLElement & { _btn?: HTMLButtonElement })._btn = btn;
      if (getComputedStyle(entry.el).position === "static") entry.el.style.position = "relative";
      entry.el.appendChild(host);
    }
    const btn = (host as HTMLElement & { _btn?: HTMLButtonElement })._btn!;
    const r = entry.result;
    if (entry.state === "done" && r) {
      const w = worthOf(r);
      btn.className = w;
      btn.replaceChildren(document.createTextNode(`${r.score}%`));
      const tier = document.createElement("span");
      tier.className = "tier";
      tier.textContent = w === "open" ? `★ ${WORTH_LABEL.open.short}` : WORTH_LABEL[w].short;
      btn.append(tier);
      const why = r.worthReasons?.length ? `\n${r.worthReasons.join(" · ")}` : "";
      btn.title = `${WORTH_LABEL[w].long}\n${r.oneLineVerdict}${why}${r.cached ? "\n(already analyzed — from cache, no AI call)" : ""}`;
    } else if (entry.state === "unscored") {
      btn.className = "unscored";
      btn.replaceChildren(document.createTextNode(settings.scoring ? "Not analyzed" : "Stopped"));
      btn.title = "Scoring is stopped (or Analyzed-only is on): this candidate is not analyzed yet, so no AI call was made. Press START in the side panel to score it.";
    } else if (entry.state === "pending") {
      btn.className = "pending";
      btn.replaceChildren();
      const dot = document.createElement("span");
      dot.className = "dot";
      btn.append(dot, document.createTextNode("Scoring…"));
      btn.title = "Scoring with AI";
    } else {
      btn.className = "err";
      btn.textContent = "AI: retry";
      btn.title = entry.error ?? "Scoring failed";
    }
  }

  function removePills() {
    document.querySelectorAll(`[${PILL_HOST_ATTR}]`).forEach((n) => n.remove());
  }

  /* ───────── scan / score loop ───────── */
  function resetAll() {
    blocked = null;
    cache.clear();
    failedAt.clear();
    entries.clear();
    lastProfileSig = "";
    prevCardHashes = new Set();
    removePills();
    document.querySelectorAll<HTMLElement>("[data-ai-scored]").forEach((el) => {
      delete el.dataset.aiScored;
      delete el.dataset.aiHash;
    });
  }

  function schedule(ms = DEBOUNCE_MS) {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(scan, ms);
  }

  function publish() {
    const list: RankEntry[] = [...entries.values()].map(({ domId, label, rawText, state, result, error, profileUrl }) => ({ domId, label, rawText, state, result, error, profileUrl }));
    void send({ type: "PUBLISH_RANKING", entries: list });
  }

  async function scan() {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    // Consume the one-shot "Score new cards" flag for THIS scan (a click that arrives mid-scan survives into the rerun).
    const scanForce = forceScore;
    forceScore = false;
    const allowed = scoringAllowed() || scanForce;
    try {
      const cards = findCards();

      // Drop entries whose element left the DOM (SPA pagination / new search).
      let changed = false;
      for (const [id, e] of entries) {
        if (!e.el.isConnected || !cards.includes(e.el)) {
          entries.delete(id);
          changed = true;
        }
      }

      const todo: (RankEntry & { el: HTMLElement; hash: string })[] = [];
      const curHashes = new Set<string>();
      for (const el of cards) {
        const domId = (el.dataset.aiId ??= `ai-${++seq}`);
        const rawText = cleanText(el, CARD_MAX_CHARS);
        const h = hashStr(rawText);
        curHashes.add(h);
        const known = entries.get(domId);

        // "unscored" cards (Analyzed-only mode) are re-evaluated once scoring is allowed again.
        if (el.dataset.aiScored === "true" && el.dataset.aiHash === h && known && !(known.state === "unscored" && allowed)) {
          if (!el.querySelector(`:scope > [${PILL_HOST_ATTR}]`)) renderPill(known); // SPA wiped our pill
          continue;
        }
        const entry = { domId, label: labelOf(rawText), rawText, state: "pending" as const, hash: h, el, profileUrl: cardLink(el) };
        const hit = cache.get(h);
        if (hit) {
          const e2 = { ...entry, state: "done" as const, result: { ...hit, domId } };
          entries.set(domId, e2);
          el.dataset.aiScored = "true";
          el.dataset.aiHash = h;
          renderPill(e2);
          changed = true;
          continue;
        }
        const lastFail = failedAt.get(h);
        if (lastFail && Date.now() - lastFail < RETRY_AFTER_MS) {
          // This element now shows a DIFFERENT candidate than the stale entry under its id: drop the stale entry, never keep old data.
          if (known && known.hash !== h) {
            entries.delete(domId);
            el.querySelector(`:scope > [${PILL_HOST_ATTR}]`)?.remove();
            changed = true;
          }
          continue;
        }
        el.dataset.aiHash = h;
        entries.set(domId, entry);
        todo.push(entry);
        changed = true;
      }

      // A new set of results (new search / filters applied / next page of a different search) → record WHICH search produced it,
      // BEFORE scoring starts, so the scored cards are linked to the right search on the server.
      noteResultSet(curHashes);

      let blockedNow = false;
      let stoppedMidway = false;
      if (!blocked && todo.length) {
        todo.forEach(renderPill);
        publish();
        for (let i = 0; i < todo.length; i += 20) {
          const chunk = todo.slice(i, i + 20);
          // STOP pressed while this scan was running: nothing more goes to the AI; the rest waits as "not analyzed".
          if (allowed && !(scoringAllowed() || scanForce)) {
            stoppedMidway = true;
            for (const c of todo.slice(i)) {
              const e = entries.get(c.domId);
              if (!e) continue;
              e.state = "unscored";
              e.result = undefined;
              delete c.el.dataset.aiScored; // re-evaluated as soon as scoring is started again
              renderPill(e);
            }
            break;
          }
          const res = await send<{ results: CardResult[]; missing: string[]; unscored?: string[] }>({
            type: "SCORE_CARDS",
            cards: chunk.map((c) => ({ domId: c.domId, rawText: c.rawText, profileUrl: c.profileUrl })),
            onlyCached: !allowed,
          });
          if (!res.ok || !res.data) {
            if (res.code === "NO_JOB" || res.code === "NOT_CONFIGURED") {
              blocked = res.code;
              for (const c of chunk) {
                entries.delete(c.domId);
                c.el.querySelector(`:scope > [${PILL_HOST_ATTR}]`)?.remove();
              }
              blockedNow = true;
              break;
            }
            for (const c of chunk) {
              const e = entries.get(c.domId);
              if (!e) continue;
              e.state = "error";
              e.error = res.error;
              failedAt.set(c.hash, Date.now());
              renderPill(e);
            }
            continue;
          }
          const byId = new Map(res.data.results.map((r) => [r.domId, r]));
          const unscoredIds = new Set(res.data.unscored ?? []);
          const mismatched: typeof chunk = [];
          for (const c of chunk) {
            const e = entries.get(c.domId);
            if (!e) continue; // card vanished meanwhile
            const r = byId.get(c.domId);
            if (!r && unscoredIds.has(c.domId)) {
              e.state = "unscored";
              e.result = undefined;
              c.el.dataset.aiScored = "true"; // don't ask again until the mode changes or the recruiter clicks "Score new cards"
            } else if (r && !resultMatchesCard(r.extracted, c.rawText)) {
              // The scorer described a DIFFERENT candidate (same name/verdict on several cards). Never show or cache it.
              mismatched.push(c);
              continue;
            } else if (r) {
              e.state = "done";
              e.result = r;
              cache.set(c.hash, r);
              c.el.dataset.aiScored = "true";
            } else {
              e.state = "error";
              e.error = "Model returned no score for this card";
              failedAt.set(c.hash, Date.now());
            }
            renderPill(e);
          }
          // Second chance: score each suspicious card ON ITS OWN, so it cannot be confused with its neighbours.
          for (const c of mismatched) {
            const e = entries.get(c.domId);
            if (!e) continue;
            const one = await send<{ results: CardResult[]; missing: string[]; unscored?: string[] }>({
              type: "SCORE_CARDS",
              cards: [{ domId: c.domId, rawText: c.rawText, profileUrl: c.profileUrl }],
              onlyCached: false,
            });
            const r1 = one.ok ? one.data?.results.find((x) => x.domId === c.domId) : undefined;
            if (r1 && resultMatchesCard(r1.extracted, c.rawText)) {
              e.state = "done";
              e.result = r1;
              cache.set(c.hash, r1);
              c.el.dataset.aiScored = "true";
            } else {
              e.state = "error";
              e.result = undefined;
              e.error = "The AI returned another candidate's details for this card, so it was discarded. Press Start again to retry.";
              failedAt.set(c.hash, Date.now());
            }
            renderPill(e);
          }
          publish();
        }
        // Logged out / no job: the "Scoring…" list published a moment ago must not linger in storage for the next HR.
        changed = blockedNow || stoppedMidway;
      } else if (blocked && todo.length) {
        // not configured: make sure nothing half-rendered stays on screen
        todo.forEach((c) => entries.delete(c.domId));
        changed = true;
      }
      if (changed) publish();

      // Profile view → hand to the background for the deep audit.
      const prof = detectProfile(cards.length);
      if (prof && !blocked) {
        const sig = hashStr(prof.url + prof.rawText);
        if (sig !== lastProfileSig) {
          lastProfileSig = sig;
          void send({ type: "PROFILE_DETECTED", ...prof });
        }
      }
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        schedule();
      }
    }
  }

  /* ───────── Naukri search sync ───────── */
  /** The search that produced the cards on screen changed iff most of the cards are new. Page N of the same search shares its signature. */
  function noteResultSet(cur: Set<string>) {
    if (!cur.size) return;
    let same = 0;
    for (const h of cur) if (prevCardHashes.has(h)) same++;
    const isNewSet = prevCardHashes.size === 0 || same / cur.size < 0.5;
    prevCardHashes = cur;
    if (!isNewSet) return;
    const state = readSearchState();
    applied = { state, sig: searchSignature(state, hashStr) };
    publishSearch(true);
  }

  let lastAppliedSig = "";
  /** Reads the live Naukri form and tells the extension (cheap, local) — only when something actually changed. */
  function publishSearch(force = false) {
    const live = readSearchState();
    const liveSig = searchSignature(live, hashStr);
    if (!applied) applied = { state: live, sig: liveSig }; // no results yet: the form IS the search
    if (!force && liveSig === lastLiveSig && applied.sig === lastAppliedSig) return;
    lastLiveSig = liveSig;
    lastAppliedSig = applied.sig;
    void send({ type: "SEARCH_STATE", snapshot: { live, liveSig, applied: applied.state, appliedSig: applied.sig, ts: Date.now() } });
  }

  /** Throttled (not debounced): a burst of events yields one read ≤ `ms` after the first, which already sees the latest values. */
  function scheduleSearchRead(ms = 400) {
    if (searchTimer) return;
    searchTimer = window.setTimeout(() => {
      searchTimer = undefined;
      publishSearch();
    }, ms);
  }

  /** SPA route change (pushState/replaceState/hash/back) → re-read the search and re-scan the (about to be replaced) cards. */
  function onUrlChange() {
    if (location.href === lastUrl && !document.hidden) {
      scheduleSearchRead(300);
      return;
    }
    lastUrl = location.href;
    lastProfileSig = ""; // a different profile/route may be showing
    scheduleSearchRead(300);
    schedule(250);
  }

  /* ───────── observers ───────── */
  const observer = new MutationObserver((records) => {
    // Ignore mutations we caused ourselves (pill hosts, our data-* attributes).
    const foreign = records.some((r) => {
      const t = r.target as Node;
      if (t instanceof Element && t.closest(`[${PILL_HOST_ATTR}]`)) return false;
      if (r.type === "childList") {
        const nodes = [...r.addedNodes, ...r.removedNodes];
        if (nodes.length && nodes.every((n) => n instanceof Element && n.hasAttribute(PILL_HOST_ATTR))) return false;
      }
      return true;
    });
    if (foreign) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", onUrlChange);
  window.addEventListener("hashchange", onUrlChange);
  // pushState/replaceState happen in the page's world, so patching history here would miss them. The Navigation API sees them
  // from the isolated world; the service worker's webNavigation listener and a cheap URL poll are the fallbacks.
  (window as unknown as { navigation?: EventTarget }).navigation?.addEventListener?.("navigatesuccess", onUrlChange);
  window.setInterval(() => {
    if (location.href !== lastUrl) onUrlChange();
  }, 700);

  // Search bar, keyword boxes, location, experience, salary and filter panels: any edit re-reads the search.
  const ours = (t: EventTarget | null) => t instanceof Element && !!t.closest(`[${PILL_HOST_ATTR}]`);
  for (const type of ["input", "change", "keyup"]) document.addEventListener(type, (e) => !ours(e.target) && scheduleSearchRead(400), true);
  document.addEventListener(
    "click",
    (e) => {
      if (ours(e.target)) return;
      scheduleSearchRead(350); // filter checkboxes / chips / dropdown picks update their state right after the click
      schedule(1200); // …and a Search/Apply click replaces the result cards shortly after
    },
    true,
  );
  document.addEventListener("keydown", (e) => e.key === "Enter" && !ours(e.target) && (scheduleSearchRead(350), schedule(1200)), true);
  // custom widgets that only flip aria-*/class when a filter is toggled
  new MutationObserver((records) => {
    if (records.some((r) => !(r.target instanceof Element && r.target.closest(`[${PILL_HOST_ATTR}]`)))) scheduleSearchRead(500);
  }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["aria-checked", "aria-pressed", "aria-selected", "checked", "class"] });
  schedule(1200);
  scheduleSearchRead(1500);

  /* ───────── side-panel commands ───────── */
  function focusCard(domId: string): boolean {
    const e = entries.get(domId);
    const el = e?.el ?? document.querySelector<HTMLElement>(`[data-ai-id="${CSS.escape(domId)}"]`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const prev = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = "3px solid #6366f1";
    el.style.outlineOffset = "2px";
    window.setTimeout(() => {
      el.style.outline = prev;
      el.style.outlineOffset = prevOffset;
    }, 2200);
    return true;
  }
}
