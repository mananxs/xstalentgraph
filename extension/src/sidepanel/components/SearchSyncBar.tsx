import { useEffect, useRef } from "react";
import { K, type ActiveJob, type SearchSnapshot } from "../../shared/types";
import { call, useSettings, useStorage } from "../lib";
import { completeDraft, describeSearch, draftFromLive, draftOf, sameDraft, type Draft } from "../searchParams";

/**
 * Mirrors the Naukri search bar + filter panels into the panel and keeps the Boolean-query box in step with them.
 *  • live    = the form as it is RIGHT NOW (updates as the recruiter types / ticks filters / SPA-navigates)
 *  • applied = the search that produced the cards currently on screen
 * With Auto-sync on, every change to the Naukri keywords / experience / location overwrites the query draft, so the panel can
 * never keep a stale query from a previous search. "Fill Resdex Search" still goes the other way, on demand.
 */
export default function SearchSyncBar({ activeJob, tabId, onResdex }: { activeJob?: ActiveJob; tabId: number | null; onResdex: boolean }) {
  const snap = useStorage<SearchSnapshot>("session", tabId === null ? null : K.search(tabId));
  const stored = useStorage<Draft & { base?: string }>("local", activeJob ? K.queryDraft(activeJob.id) : null);
  const [settings, setSettings] = useSettings();
  const lastAuto = useRef("");

  const base = activeJob ? draftOf(activeJob) : null;
  const draft: Draft | null = stored && activeJob ? completeDraft(stored, activeJob) : base;
  const liveDraft = snap && draft ? draftFromLive(snap.live, draft) : null;
  const inSync = !!draft && !!liveDraft && sameDraft(draft, liveDraft);
  const resultsStale = !!snap && snap.liveSig !== snap.appliedSig;

  function pull() {
    if (!activeJob || !liveDraft) return;
    void chrome.storage.local.set({ [K.queryDraft(activeJob.id)]: { ...liveDraft, base: JSON.stringify(draftOf(activeJob)) } });
  }

  // Auto-sync: follow the Naukri form whenever its signature changes (and the query isn't already identical).
  useEffect(() => {
    if (!settings.autoSync || !snap || !activeJob || !liveDraft || inSync) return;
    if (lastAuto.current === `${activeJob.id}|${snap.liveSig}`) return;
    const t = setTimeout(() => {
      lastAuto.current = `${activeJob.id}|${snap.liveSig}`;
      pull();
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoSync, snap?.liveSig, activeJob?.id, inSync]);

  if (!onResdex || tabId === null) return null;
  const live = snap ? describeSearch(snap.live) : [];

  return (
    <section className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Naukri search (live)</h2>
        <button className="text-xs text-indigo-600 hover:underline" onClick={() => void call({ type: "READ_SEARCH", tabId }).catch(() => {})} title="Re-read the search bar and filters now">
          ↻ Re-read
        </button>
      </div>
      {!snap ? (
        <p className="text-[12px] text-slate-500">Open a Resdex search page — the keywords, location, experience, salary and filters you set there appear here as you change them.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {live.length ? live.map((p) => <span key={p} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">{p}</span>) : <span className="text-[12px] text-slate-400">Empty search</span>}
          </div>
          {resultsStale && <p className="rounded bg-amber-50 p-1.5 text-[11px] text-amber-800">You changed the search — the results on screen are from the previous one. Press Search on Resdex to refresh them.</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <label className="flex items-center gap-1 text-slate-600">
              <input type="checkbox" checked={settings.autoSync} onChange={(e) => setSettings({ autoSync: e.target.checked })} /> Auto-sync query box
            </label>
            {activeJob && !inSync && liveDraft && (
              <button className="font-medium text-indigo-600 hover:underline" onClick={pull}>
                Use Naukri’s current search ↓
              </button>
            )}
            {activeJob && inSync && <span className="text-emerald-700">✓ Query box matches Naukri</span>}
          </div>
        </>
      )}
    </section>
  );
}
