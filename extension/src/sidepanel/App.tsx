import { useEffect, useState } from "react";
import { K, type ActiveJob, type Config, type RankEntry } from "../shared/types";
import AuthGate from "./components/AuthGate";
import CandidateDetailTab from "./components/CandidateDetailTab";
import JobSelector from "./components/JobSelector";
import AnalyzedTab from "./components/AnalyzedTab";
import LiveRankingTab from "./components/LiveRankingTab";
import ScoringToggle from "./components/ScoringToggle";
import SearchSyncBar from "./components/SearchSyncBar";
import { call, useActiveTab, useStorage } from "./lib";

type Tab = "ranking" | "analyzed" | "detail";

export default function App() {
  const config = useStorage<Config>("local", K.config);
  const activeJob = useStorage<ActiveJob>("local", K.activeJob);
  const { tabId, onResdex } = useActiveTab();
  const [tab, setTab] = useState<Tab>("ranking");
  const [ready, setReady] = useState(false);
  const focus = useStorage<{ domId: string; ts: number }>("session", tabId === null ? null : K.focus(tabId));
  const detail = useStorage<{ key: string }>("session", tabId === null ? null : K.detail(tabId));

  // `useStorage` starts as undefined → wait one tick so we don't flash the AuthGate for connected users.
  useEffect(() => {
    chrome.storage.local.get(K.config).then(() => setReady(true));
  }, []);

  // Make sure the content script is alive on tabs that were open before install/update.
  useEffect(() => {
    if (tabId !== null && onResdex) void call({ type: "ENSURE_CONTENT", tabId }).catch(() => {});
  }, [tabId, onResdex]);

  // Pill clicked on the page → jump to the ranking tab. New profile detected → jump to the detail tab.
  useEffect(() => {
    if (focus) setTab("ranking");
  }, [focus]);
  useEffect(() => {
    if (detail?.key) setTab("detail");
  }, [detail?.key]);

  if (!ready) return null;
  if (!config) return <div className="p-3"><AuthGate /></div>;

  function audit(e: RankEntry) {
    if (tabId === null) return;
    setTab("detail");
    void call({ type: "ANALYZE_TEXT", tabId, rawText: e.rawText, label: e.label, url: `card:${e.domId}` }).catch(() => {});
  }

  /** Log out: the background wipes this HR's key, active job, query drafts and every tab's cached ranking/search state. */
  function logout() {
    void call({ type: "LOGOUT" }).catch(() => {});
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[380px] flex-col gap-3 p-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-indigo-600 text-xs text-white">R</span>
          XS-NaukriAI
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className="max-w-[160px] truncate" title={config.user ? `${config.user.name ?? ""} <${config.user.email}> · ${config.baseUrl}` : config.baseUrl}>
            {config.user?.name || config.user?.email || "Connected"}
          </span>
          <button className="hover:text-rose-600" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {!onResdex && (
        <p className="rounded-md bg-amber-50 p-2 text-[12px] text-amber-800">Switch to a resdex.naukri.com tab to score candidates.</p>
      )}

      <ScoringToggle tabId={tabId} onResdex={onResdex} />
      <JobSelector activeJob={activeJob} tabId={tabId} onResdex={onResdex} />
      <SearchSyncBar activeJob={activeJob} tabId={tabId} onResdex={onResdex} />

      <nav className="grid grid-cols-3 rounded-lg bg-slate-200 p-0.5 text-[12px] font-medium">
        {(
          [
            ["ranking", "Live Ranking"],
            ["analyzed", "Analyzed"],
            ["detail", "Candidate Detail"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`rounded-md py-1.5 ${tab === id ? "bg-white shadow-sm" : "text-slate-600"}`}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "ranking" ? (
        <LiveRankingTab tabId={tabId} onResdex={onResdex} jobId={activeJob?.id} onAudit={audit} />
      ) : tab === "analyzed" ? (
        <AnalyzedTab tabId={tabId} onResdex={onResdex} jobId={activeJob?.id} />
      ) : (
        <CandidateDetailTab tabId={tabId} />
      )}
    </div>
  );
}
