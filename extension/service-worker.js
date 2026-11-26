const DEFAULT_SETTINGS = { analyzedOnly: false, autoSync: true, scoring: false };
const K = {
  config: "config",
  // local
  activeJob: "activeJob",
  // local
  settings: "settings",
  // local — Settings
  search: (tabId) => `search:${tabId}`,
  // session — SearchSnapshot
  searchSession: (tabId) => `searchSession:${tabId}`,
  // session — SearchSessionInfo for the applied search
  rank: (tabId) => `rank:${tabId}`,
  // session
  detail: (tabId) => `detail:${tabId}`,
  // session
  focus: (tabId) => `focus:${tabId}`,
  // session
  saved: (tabId) => `saved:${tabId}`,
  // session — SaveMap of cards saved to the shortlist
  queryDraft: (jobId) => `queryDraft:${jobId}`
  // local — recruiter's edited Boolean/exp/location
};
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function resultMatchesCard(extracted, rawText) {
  if (!extracted) return true;
  const text = ` ${norm(rawText)} `;
  const name = norm(extracted.fullName);
  if (!name) return true;
  const parts = name.split(" ").filter((w) => w.length >= 2);
  if (!parts.length) return true;
  const hit = parts.filter((w) => text.includes(` ${w} `) || text.includes(` ${w}`)).length;
  if (hit / parts.length < 0.6) return false;
  const company = norm(extracted.currentCompany);
  if (company.length >= 4) {
    const words = company.split(" ").filter((w) => w.length >= 3);
    if (words.length && !words.some((w) => text.includes(w))) return false;
  }
  return true;
}
async function stopScoring() {
  const cur = (await chrome.storage.local.get(K.settings))[K.settings] ?? {};
  await chrome.storage.local.set({ [K.settings]: { ...DEFAULT_SETTINGS, ...cur, scoring: false } });
}
chrome.runtime.onInstalled.addListener(async () => {
  await stopScoring().catch(() => {
  });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  });
  const tabs = await chrome.tabs.query({ url: "https://resdex.naukri.com/*" }).catch(() => []);
  for (const t of tabs) if (t.id) await injectContent(t.id);
});
chrome.runtime.onStartup.addListener(() => {
  void stopScoring().catch(() => {
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([K.rank(tabId), K.detail(tabId), K.focus(tabId), K.saved(tabId), K.search(tabId), K.searchSession(tabId)]).catch(() => {
  });
});
const resdexNav = { url: [{ hostEquals: "resdex.naukri.com" }] };
const urlChanged = (d) => {
  if (d.frameId === 0) chrome.tabs.sendMessage(d.tabId, { type: "URL_CHANGED" }).catch(() => {
  });
};
chrome.webNavigation?.onHistoryStateUpdated.addListener(urlChanged, resdexNav);
chrome.webNavigation?.onReferenceFragmentUpdated.addListener(urlChanged, resdexNav);
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  route(msg, sender).then((data) => sendResponse({ ok: true, data })).catch((e) => sendResponse({ ok: false, error: e.message, code: e.code }));
  return true;
});
async function route(msg, sender) {
  switch (msg.type) {
    case "SCORE_CARDS": {
      const job = await requireJob();
      const tabId = sender.tab?.id;
      const session = tabId !== void 0 ? await ensureSearchSession(tabId, job.id).catch(() => null) : null;
      const results = [];
      const missing = [];
      const unscored = [];
      for (let i = 0; i < msg.cards.length; i += 20) {
        const chunk = msg.cards.slice(i, i + 20);
        const r = await api("/score-batch", {
          jobId: job.id,
          candidates: chunk,
          onlyCached: msg.onlyCached || void 0,
          searchSessionId: session?.id
        });
        results.push(...r.results);
        missing.push(...r.missing);
        unscored.push(...r.unscored ?? []);
      }
      return { results, missing, unscored };
    }
    case "SEARCH_STATE": {
      const tabId = sender.tab?.id;
      await getConfig();
      if (tabId !== void 0) await chrome.storage.session.set({ [K.search(tabId)]: msg.snapshot });
      return null;
    }
    case "PUBLISH_RANKING": {
      const tabId = sender.tab?.id;
      if (tabId !== void 0) await chrome.storage.session.set({ [K.rank(tabId)]: msg.entries });
      return null;
    }
    case "PROFILE_DETECTED": {
      const tabId = sender.tab?.id;
      if (tabId === void 0) return null;
      const job = (await chrome.storage.local.get(K.activeJob))[K.activeJob];
      const cfg = (await chrome.storage.local.get(K.config))[K.config];
      if (!job || !cfg) return null;
      await analyze(tabId, msg.rawText, msg.label, msg.url, job.id);
      return null;
    }
    case "CARD_CLICKED": {
      const tabId = sender.tab?.id;
      if (tabId === void 0) return null;
      await chrome.storage.session.set({ [K.focus(tabId)]: { domId: msg.domId, ts: Date.now() } });
      await chrome.sidePanel.open({ tabId }).catch(() => {
      });
      return null;
    }
    case "CONNECT": {
      const me = await rawApi(msg.config, "/me", void 0, void 0, true).catch(async (e) => {
        if (!/404|not found/i.test(e.message)) throw e;
        await rawApi(msg.config, "/jobs", void 0, void 0, true);
        return { user: void 0 };
      });
      await adoptConfig({ ...msg.config, baseUrl: msg.config.baseUrl.replace(/\/+$/, ""), user: me.user });
      return me.user ?? null;
    }
    case "LOGIN": {
      const base = msg.baseUrl.replace(/\/+$/, "");
      let res;
      try {
        res = await fetch(`${base}/api/extension/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: msg.email, password: msg.password }) });
      } catch {
        throw new BgError(`Cannot reach ${base}. Is the server running and the URL correct?`);
      }
      const data = await res.json().catch(() => ({}));
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
      const list = await api(`/analyzed?${q}`);
      return { ...list, scope: session ? "search" : "job", session };
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
      return (await api("/jobs")).jobs;
    case "CREATE_ADHOC_JOB":
      return (await api("/jobs", { rawDescription: msg.rawDescription, title: msg.title }, "POST")).job;
    case "ANALYZE_TEXT": {
      const job = await requireJob();
      await analyze(msg.tabId, msg.rawText, msg.label, msg.url, job.id, true);
      return null;
    }
    case "SAVE_CANDIDATE":
      return saveCandidate(msg.tabId);
    case "FILL_SEARCH":
      return fillSearch(msg.tabId, msg.fields ?? { booleanQuery: msg.keywords ?? "", minExp: null, maxExp: null, locations: [] });
    case "SAVE_CARDS":
      return enqueueSave(msg.tabId, msg.cards);
    case "FOCUS_CARD":
      return toTab(msg.tabId, { type: "FOCUS_CARD", domId: msg.domId });
    case "ENSURE_CONTENT":
      return ensureContent(msg.tabId);
  }
}
class BgError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
async function getConfig() {
  const cfg = (await chrome.storage.local.get(K.config))[K.config];
  if (!cfg?.baseUrl || !cfg.apiKey) throw new BgError("Not connected — enter your Platform URL and API key.", "NOT_CONFIGURED");
  return cfg;
}
async function requireJob() {
  await getConfig();
  const job = (await chrome.storage.local.get(K.activeJob))[K.activeJob];
  if (!job) throw new BgError("Select an active job in the side panel first.", "NO_JOB");
  return job;
}
async function api(path, body, method) {
  return rawApi(await getConfig(), path, body, method);
}
async function rawApi(cfg, path, body, method, validating = false) {
  let res;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/api/extension${path}`, {
      method: method ?? (body === void 0 ? "GET" : "POST"),
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
  } catch {
    throw new BgError(`Cannot reach ${cfg.baseUrl}. Is the server running and the URL correct?`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !validating) {
    await clearUserState();
    throw new BgError("Your session expired — please log in again.", "NOT_CONFIGURED");
  }
  if (!res.ok) throw new BgError(data.error ?? `Request failed (${res.status})`);
  return data;
}
async function clearUserState() {
  const all = await chrome.storage.local.get(null);
  const doomed = Object.keys(all).filter((k) => k === K.config || k === K.activeJob || k.startsWith("queryDraft:"));
  await chrome.storage.local.remove(doomed);
  await chrome.storage.session.clear();
  await stopScoring().catch(() => {
  });
}
async function adoptConfig(next) {
  const prev = (await chrome.storage.local.get(K.config))[K.config];
  const sameHr = !!prev && prev.baseUrl === next.baseUrl && (prev.user?.id ?? prev.apiKey) === (next.user?.id ?? next.apiKey);
  if (prev && !sameHr) await clearUserState();
  await chrome.storage.local.set({ [K.config]: next });
}
const inflightSessions = /* @__PURE__ */ new Map();
function ensureSearchSession(tabId, jobId) {
  const run = async () => {
    const snap = (await chrome.storage.session.get(K.search(tabId)))[K.search(tabId)];
    if (!snap) return null;
    const cur = (await chrome.storage.session.get(K.searchSession(tabId)))[K.searchSession(tabId)];
    if (cur && cur.sig === snap.appliedSig && cur.jobId === jobId) return cur;
    const r = await api("/search-session", { jobId, signature: snap.appliedSig, state: snap.applied });
    const info = { id: r.session.id, sig: snap.appliedSig, jobId, label: r.session.label, analyzedCount: r.session.analyzedCount };
    await chrome.storage.session.set({ [K.searchSession(tabId)]: info });
    return info;
  };
  return (async () => {
    const snap = (await chrome.storage.session.get(K.search(tabId)))[K.search(tabId)];
    const key = `${tabId}|${jobId}|${snap?.appliedSig ?? ""}`;
    let p = inflightSessions.get(key);
    if (!p) {
      p = run().finally(() => inflightSessions.delete(key));
      inflightSessions.set(key, p);
    }
    return p;
  })();
}
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
}
async function analyze(tabId, rawText, label, url, jobId, force = false) {
  const key = hash(`${jobId}|${url}|${rawText}`);
  const existing = (await chrome.storage.session.get(K.detail(tabId)))[K.detail(tabId)];
  if (!force && existing?.key === key && existing.status !== "error") return;
  const base = { key, status: "loading", label, url, rawText, jobId };
  await chrome.storage.session.set({ [K.detail(tabId)]: base });
  try {
    const { audit } = await api("/score-profile", { jobId, rawText, profileUrl: url });
    await chrome.storage.session.set({ [K.detail(tabId)]: { ...base, status: "ready", audit } });
  } catch (e) {
    await chrome.storage.session.set({ [K.detail(tabId)]: { ...base, status: "error", error: e.message } });
  }
}
async function saveCandidate(tabId) {
  const st = (await chrome.storage.session.get(K.detail(tabId)))[K.detail(tabId)];
  if (!st?.audit) throw new BgError("Nothing to save yet — wait for the AI audit.");
  const put = (save) => chrome.storage.session.set({ [K.detail(tabId)]: { ...st, save } });
  await put({ status: "saving" });
  try {
    const live = await readProfile(tabId).catch(() => null);
    const rawText = live?.open && live.rawText.length > 300 ? live.rawText : st.rawText;
    const r = await api("/import-candidate", {
      jobId: st.jobId,
      profileUrl: st.url,
      rawText,
      audit: stripTier(st.audit)
    });
    const cfg = await getConfig();
    await put({ status: "saved", duplicate: r.duplicate, webUrl: `${cfg.baseUrl.replace(/\/+$/, "")}${r.webUrl}`, candidateId: r.candidate.id, contact: r.contact, cv: { status: live?.cvLinks.length ? "idle" : "none" } });
    return null;
  } catch (e) {
    await put({ status: "error", error: e.message });
    throw e;
  }
}
async function readProfile(tabId) {
  if (!await ensureContent(tabId)) throw new BgError("Couldn't reach the Resdex tab. Refresh the page (F5) and try again.");
  const r = await chrome.tabs.sendMessage(tabId, { type: "READ_PROFILE" }).catch(() => null);
  if (!r) throw new BgError("This Resdex tab is running an old copy of the extension. Refresh the page (F5).");
  return r;
}
async function attachCv(tabId) {
  const st = (await chrome.storage.session.get(K.detail(tabId)))[K.detail(tabId)];
  const candidateId = st?.save?.candidateId;
  if (!st || !candidateId) throw new BgError("Save the candidate first, then attach the CV.");
  const setCv = (cv, extra = {}) => chrome.storage.session.set({ [K.detail(tabId)]: { ...st, save: { ...st.save, ...extra, cv } } });
  await setCv({ status: "fetching" });
  try {
    const prof = await readProfile(tabId);
    const link = prof.cvLinks[0];
    if (!link) {
      await setCv({ status: "none" });
      throw new BgError("No CV download link is visible on this profile.");
    }
    const got = await chrome.tabs.sendMessage(tabId, { type: "FETCH_CV", href: link.href });
    if (!got?.ok || !got.base64) throw new BgError(got?.error ?? "Couldn't download the CV");
    const bytes = Uint8Array.from(atob(got.base64), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append("file", new File([bytes], got.name ?? "cv.pdf", { type: got.mime }));
    const cfg = await getConfig();
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/api/extension/candidates/${candidateId}/resume`, { method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new BgError(data.error ?? `Upload failed (${res.status})`);
    await setCv(
      { status: "saved", fileName: data.resume?.fileName ?? got.name, phoneFromCv: data.phoneFromCv },
      { contact: { phone: data.phone ?? st.save?.contact?.phone ?? null, email: data.email ?? st.save?.contact?.email ?? null, phoneMasked: false } }
    );
    return null;
  } catch (e) {
    const cur = (await chrome.storage.session.get(K.detail(tabId)))[K.detail(tabId)];
    if (cur?.save?.cv?.status !== "none") await chrome.storage.session.set({ [K.detail(tabId)]: { ...cur, save: { ...cur?.save, cv: { status: "error", error: e.message } } } });
    throw e;
  }
}
let saveChain = Promise.resolve();
function enqueueSave(tabId, cards) {
  const run = saveChain.then(() => saveCards(tabId, cards));
  saveChain = run.catch(() => void 0);
  return run;
}
const known = (n) => typeof n === "number" && n >= 0 ? n : null;
async function saveCards(tabId, cards) {
  const job = await requireJob();
  const key = K.saved(tabId);
  const map = (await chrome.storage.session.get(key))[key] ?? {};
  const flush = () => chrome.storage.session.set({ [key]: map });
  let saved = 0;
  let failed = 0;
  for (const c of cards) if (map[c.key]?.status !== "saved") map[c.key] = { status: "saving" };
  await flush();
  for (const c of cards) {
    if (map[c.key]?.status === "saved") continue;
    const r = c.result;
    const x = r.extracted;
    if (!resultMatchesCard(x, c.rawText)) {
      map[c.key] = { status: "error", error: "This card's AI result does not match the candidate on screen. Press Start to re-score it, then save." };
      failed++;
      await flush();
      continue;
    }
    try {
      const res = await api("/import-candidate", {
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
          verdict: r.oneLineVerdict
        }
      });
      map[c.key] = { status: "saved", duplicate: res.duplicate, keptFullProfile: res.keptFullProfile };
      saved++;
    } catch (e) {
      map[c.key] = { status: "error", error: e.message };
      failed++;
    }
    await flush();
  }
  return { saved, failed };
}
function stripTier(a) {
  const { tier: _tier, ...rest } = a;
  return rest;
}
async function fillSearch(tabId, fields) {
  if (!await ensureContent(tabId)) throw new BgError("Couldn't reach the Resdex tab. Refresh the page (F5) and try again.");
  const pong = await chrome.tabs.sendMessage(tabId, { type: "PING" }).catch(() => null);
  if (!pong || (pong.v ?? 0) < 4) throw new BgError("This Resdex tab is still running an old copy of the extension. Refresh the page (F5), then click Fill again.");
  return chrome.tabs.sendMessage(tabId, { type: "FILL_RESDEX_SEARCH", fields });
}
async function toTab(tabId, msg) {
  await ensureContent(tabId);
  return chrome.tabs.sendMessage(tabId, msg);
}
async function ensureContent(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return true;
  } catch {
    return injectContent(tabId);
  }
}
async function injectContent(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return true;
  } catch {
    return false;
  }
}
