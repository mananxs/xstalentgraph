import { useCallback, useEffect, useRef, useState } from "react";
import { K, type ActiveJob, type FillReport, type JobSummary } from "../../shared/types";
import { call } from "../lib";
import { Pill } from "../Pill";
import { completeDraft, draftOf, draftToFill, toActive, type Draft } from "../searchParams";


export default function JobSelector({ activeJob, tabId, onResdex }: { activeJob?: ActiveJob; tabId: number | null; onResdex: boolean }) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adhoc, setAdhoc] = useState(false);
  const [jd, setJd] = useState("");
  const [busy, setBusy] = useState(false);
  const [fillMsg, setFillMsg] = useState<{ ok: boolean; text: string; notes?: string[]; fields?: FillReport["fields"] } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [copied, setCopied] = useState(false);
  const activeRef = useRef(activeJob);
  activeRef.current = activeJob;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await call<JobSummary[]>({ type: "GET_JOBS" });
      setJobs(list);
      // Refresh the stored job's search fields (older builds / re-analysed JD). Same id → the content script does NOT re-score.
      const cur = activeRef.current;
      const fresh = cur && list.find((j) => j.id === cur.id);
      if (fresh && JSON.stringify(toActive(fresh)) !== JSON.stringify(cur)) await chrome.storage.local.set({ [K.activeJob]: toActive(fresh) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);
  // Platform edits / new jobs appear without pressing Sync: on focus, and every 30 s while the panel is visible.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);
  // Pick up edits made on the dashboard whenever the panel regains focus.
  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && void load();
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onVis);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  // The recruiter's edited draft survives closing the panel — but only while it was based on the CURRENT generated values.
  // If the job was edited/re-analysed (generated values changed) the stale draft is dropped so the new query shows.
  const jobKey = activeJob?.id;
  const generated = activeJob ? JSON.stringify(draftOf(activeJob)) : "";
  useEffect(() => {
    const job = activeRef.current;
    if (!job) return setDraft(null);
    let alive = true;
    chrome.storage.local
      .get(K.queryDraft(job.id))
      .then((o) => {
        const st = o[K.queryDraft(job.id)] as (Draft & { base?: string }) | undefined;
        if (!alive) return;
        if (st && st.base === generated) setDraft(completeDraft(st, job));
        else {
          setDraft(draftOf(job));
          if (st) void chrome.storage.local.remove(K.queryDraft(job.id));
        }
      })
      .catch(() => alive && setDraft(draftOf(job)));
    return () => {
      alive = false;
    };
  }, [jobKey, generated]);

  // The Naukri sync bar (and auto-sync) writes the same stored draft — follow it.
  useEffect(() => {
    if (!jobKey) return;
    const key = K.queryDraft(jobKey);
    const on = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      const v = area === "local" ? (c[key]?.newValue as (Draft & { base?: string }) | undefined) : undefined;
      if (v && activeRef.current) setDraft(completeDraft(v, activeRef.current));
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, [jobKey]);

  const edit = (p: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...(d ?? (activeRef.current ? draftOf(activeRef.current) : ({ q: "", min: "", max: "", loc: "", all: "", any: "", exclude: "", desig: "", maxSal: "", notice: "", edu: "", bool: true } as Draft))), ...p };
      if (activeRef.current) void chrome.storage.local.set({ [K.queryDraft(activeRef.current.id)]: { ...next, base: JSON.stringify(draftOf(activeRef.current)) } });
      return next;
    });
  };
  const resetDraft = () => {
    if (!activeJob) return;
    void chrome.storage.local.remove(K.queryDraft(activeJob.id));
    setDraft(draftOf(activeJob));
  };

  const select = (j: JobSummary) => chrome.storage.local.set({ [K.activeJob]: toActive(j) });

  async function analyzeAdhoc() {
    setBusy(true);
    setError("");
    try {
      const job = await call<JobSummary>({ type: "CREATE_ADHOC_JOB", rawDescription: jd });
      setJobs((js) => [job, ...js]);
      await select(job);
      setJd("");
      setAdhoc(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyQuery() {
    if (!draft?.q) return;
    try {
      await navigator.clipboard.writeText(draft.q);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = draft.q;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function fill() {
    if (!activeJob || tabId === null || !draft) return;
    setFillMsg(null);
    try {
      const r = await call<FillReport>({ type: "FILL_SEARCH", tabId, fields: draftToFill(draft) });
      if (!r?.ok) return setFillMsg({ ok: false, text: r?.error ?? "Failed", notes: r?.notes, fields: r?.fields });
      const n = r.fields.filter((f) => f.status === "filled").length;
      const todo = r.fields.filter((f) => f.status !== "filled").length;
      setFillMsg({ ok: true, text: `Filled ${n} field${n === 1 ? "" : "s"}${todo ? ` · ${todo} need a look` : ""} — review, then press Search on Resdex yourself.`, notes: r.notes, fields: r.fields });
    } catch (e) {
      setFillMsg({ ok: false, text: (e as Error).message });
    }
  }

  /** Diagnostic: what the Resdex form looks like to the matcher (labels/placeholders only, no typed values). */
  async function copyFormMap() {
    if (tabId === null) return;
    try {
      const map = await call<unknown>({ type: "MAP_FORM", tabId });
      await navigator.clipboard.writeText(JSON.stringify(map, null, 1));
      setFillMsg({ ok: true, text: "Form map copied — paste it to whoever maintains the extension if a field isn't being filled." });
    } catch (e) {
      setFillMsg({ ok: false, text: (e as Error).message });
    }
  }

  const selected = jobs.find((j) => j.id === activeJob?.id);
  const edited = !!(activeJob && draft && JSON.stringify(draft) !== generated);
  const canFill = !!activeJob && !!draft && (!!draft.q.trim() || !!draft.all.trim() || !!draft.min || !!draft.max || !!draft.loc.trim() || !!draft.desig.trim()) && onResdex;

  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active job</h2>
        <button className="text-xs text-indigo-600 hover:underline" onClick={load} disabled={loading}>
          {loading ? "Syncing…" : "↻ Sync"}
        </button>
      </div>

      <select
        className="input"
        value={activeJob?.id ?? ""}
        onChange={(e) => {
          const j = jobs.find((x) => x.id === e.target.value);
          if (j) void select(j);
        }}
      >
        <option value="" disabled>
          {jobs.length ? "Select a job…" : "No active jobs"}
        </option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.title} ({j.candidateCount})
          </option>
        ))}
        {activeJob && !selected && <option value={activeJob.id}>{activeJob.title}</option>}
      </select>

      {activeJob && (
        <div className="flex flex-wrap gap-1">
          {activeJob.mustHaveSkills.slice(0, 8).map((s) => (
            <Pill key={s} tone="indigo">
              {s}
            </Pill>
          ))}
        </div>
      )}

      {activeJob && draft && (
        <div className="space-y-1.5 rounded-lg border border-violet-200 bg-violet-50/50 p-2">
          <div className="flex items-center justify-between">
            <label htmlFor="bq" className="text-[11px] font-semibold uppercase tracking-wide text-violet-800">
              Resdex Boolean query
            </label>
            <div className="flex items-center gap-2">
              {edited && (
                <button className="text-[11px] text-slate-500 hover:underline" onClick={resetDraft}>
                  Reset
                </button>
              )}
              <button className="rounded bg-violet-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-40" onClick={copyQuery} disabled={!draft.q}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>
          <textarea
            id="bq"
            className="input h-20 resize-y font-mono text-[11px] leading-snug"
            spellCheck={false}
            value={draft.q}
            onChange={(e) => edit({ q: e.target.value })}
            placeholder="(React OR ReactJS) AND Node.js NOT Intern"
          />
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>Edit freely — nothing runs until you press Search on Resdex.</span>
            <span className={draft.q.length > 380 ? "font-semibold text-rose-600" : ""}>{draft.q.length}/380</span>
          </div>
          <div className="grid grid-cols-[1fr_1fr_2fr] gap-1.5">
            <label className="text-[10px] font-medium text-slate-600">
              Min exp
              <input className="input mt-0.5" inputMode="decimal" value={draft.min} onChange={(e) => edit({ min: e.target.value })} placeholder="—" />
            </label>
            <label className="text-[10px] font-medium text-slate-600">
              Max exp
              <input className="input mt-0.5" inputMode="decimal" value={draft.max} onChange={(e) => edit({ max: e.target.value })} placeholder="—" />
            </label>
            <label className="text-[10px] font-medium text-slate-600">
              Location(s)
              <input className="input mt-0.5" value={draft.loc} onChange={(e) => edit({ loc: e.target.value })} placeholder="Bengaluru, Pune" />
            </label>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-700">
            <input type="checkbox" checked={draft.bool} onChange={(e) => edit({ bool: e.target.checked })} />
            Switch Resdex to <b>Boolean mode</b> when it has a toggle
          </label>
          <details className="rounded border border-violet-200 bg-white p-1.5" open>
            <summary className="cursor-pointer text-[11px] font-semibold text-violet-800">More Resdex fields (filled together with the query)</summary>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {(
                [
                  ["all", "All of these keywords", "Java, Kubernetes"],
                  ["any", "Any of these keywords", "Kafka, Spring Boot"],
                  ["exclude", "Exclude keywords", "Intern, Trainee"],
                  ["desig", "Designation(s)", "Java Developer, Backend Engineer"],
                ] as const
              ).map(([k, label, ph]) => (
                <label key={k} className="col-span-2 text-[10px] font-medium text-slate-600">
                  {label}
                  <input className="input mt-0.5" value={draft[k]} onChange={(e) => edit({ [k]: e.target.value })} placeholder={ph} />
                </label>
              ))}
              <label className="text-[10px] font-medium text-slate-600">
                Max salary (LPA)
                <input className="input mt-0.5" inputMode="decimal" value={draft.maxSal} onChange={(e) => edit({ maxSal: e.target.value })} placeholder="—" />
              </label>
              <label className="text-[10px] font-medium text-slate-600">
                Notice ≤ (days)
                <input className="input mt-0.5" inputMode="numeric" value={draft.notice} onChange={(e) => edit({ notice: e.target.value })} placeholder="—" />
              </label>
              <label className="col-span-2 text-[10px] font-medium text-slate-600">
                Education
                <input className="input mt-0.5" value={draft.edu} onChange={(e) => edit({ edu: e.target.value })} placeholder="B.Tech / BE" />
              </label>
            </div>
          </details>
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => setAdhoc((a) => !a)}>
          {adhoc ? "Cancel" : "+ Ad-hoc JD"}
        </button>
        <button className="btn-primary flex-1" disabled={!canFill} onClick={fill} title={onResdex ? "Types the values into Resdex — does not press Search" : "Open resdex.naukri.com first"}>
          Fill Resdex Search (all fields)
        </button>
      </div>
      {onResdex && (
        <button className="text-[10px] text-slate-400 hover:text-indigo-600 hover:underline" onClick={() => void copyFormMap()}>
          Copy form map (diagnostics)
        </button>
      )}
      {fillMsg && (
        <div className={`text-xs ${fillMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>
          <p>{fillMsg.text}</p>
          {fillMsg.fields && fillMsg.fields.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-slate-700">
              {fillMsg.fields.map((f) => (
                <li key={`${f.key}-${f.label}`} className="flex gap-1">
                  <span className={f.status === "filled" ? "text-emerald-600" : f.status === "manual" ? "text-amber-600" : "text-rose-500"}>{f.status === "filled" ? "✓" : f.status === "manual" ? "◐" : "✕"}</span>
                  <span>
                    <b>{f.label}</b>
                    {f.detail ? <span className="text-slate-500"> — {f.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {fillMsg.notes?.map((n) => (
            <p key={n} className="mt-0.5 text-slate-500">
              • {n}
            </p>
          ))}
        </div>
      )}

      {adhoc && (
        <div className="space-y-2">
          <textarea className="input h-32 resize-none" placeholder="Paste a quick job description…" value={jd} onChange={(e) => setJd(e.target.value)} />
          <button className="btn-primary w-full" disabled={busy || jd.trim().length < 40} onClick={analyzeAdhoc}>
            {busy ? "Analyzing with AI…" : "Analyze & use this JD"}
          </button>
        </div>
      )}
      {error && <p className="rounded bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
    </section>
  );
}
