"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Pause, Play, PlugZap, RefreshCw, Square, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toMessage } from "@/lib/api";
import { hunt, type ConnectionView, type FieldStatus, type RunState, type SearchFilters, type TaskView } from "@/lib/hunt";
import { ChipInput } from "../ChipInput";
import { Badge, Button, Card, inputClass, Notice, ProgressBar, Skeleton } from "./ui";
import { X } from "lucide-react";

const NAUKRI_TEXT: Record<string, { tone: "green" | "amber" | "red" | "neutral"; text: string }> = {
  signed_in: { tone: "green", text: "Signed in to Naukri Resdex" },
  signed_out: { tone: "red", text: "Signed out of Naukri. Open Resdex in the extension's browser and sign in." },
  captcha: { tone: "amber", text: "Naukri is showing a security check. Solve it yourself in that tab, then check again." },
  expired: { tone: "red", text: "Your Naukri session expired. Sign in again in that browser." },
  no_tab: { tone: "amber", text: "No Resdex tab is open in the extension's browser." },
  unknown: { tone: "neutral", text: "Naukri session not checked yet." },
};

const FIELD_STATUS: Record<FieldStatus, { tone: "green" | "amber" | "red" | "neutral"; text: string }> = {
  applied: { tone: "green", text: "Applied" },
  unsupported: { tone: "neutral", text: "Unsupported" },
  failed: { tone: "red", text: "Failed" },
  attention: { tone: "amber", text: "Requires attention" },
};

const MAPPED = new Set(["boolean", "keywords", "anyKeywords", "excludeKeywords", "designation", "minExp", "maxExp", "location", "minSalary", "maxSalary", "notice", "education"]);

const ago = (iso: string | null) => (iso ? `${Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))}s ago` : "never");

/** Find Candidates on Naukri: connection, filters (apply + verify), independent Sourcing and AI controls, live progress. */
export function FindCandidatesPanel({ jobId, canEdit, onClose, onCandidatesChanged }: { jobId: string; canEdit: boolean; onClose: () => void; onCandidatesChanged: () => void }) {
  const [task, setTask] = useState<TaskView | null | undefined>(undefined);
  const [conn, setConn] = useState<ConnectionView | null>(null);
  const [filters, setFilters] = useState<SearchFilters | null>(null);
  const [limits, setLimits] = useState<TaskView["limits"] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<null | "apply_filters" | "check_session">(null);
  const [skipFilters, setSkipFilters] = useState(false);
  const aiLoop = useRef(false);
  const lastCaptured = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([hunt.connection(), task === undefined ? hunt.task(jobId).then((r) => r.task) : hunt.taskById(task?.id ?? "").then((r) => r.task).catch(() => null)]);
      setConn(c);
      if (t) {
        setTask(t);
        if (!dirty) {
          setFilters(t.filters);
          setLimits(t.limits);
        }
        if (t.counters.captured !== lastCaptured.current) {
          lastCaptured.current = t.counters.captured;
          onCandidatesChanged();
        }
        setWaiting((w) => {
          const cmdType = w ?? null;
          if (!cmdType) return null;
          const latest = t.commands.find((x) => x.type === cmdType);
          return latest && (latest.status === "done" || latest.status === "failed") ? null : w;
        });
      } else if (task === undefined) setTask(null);
    } catch (e) {
      setError(toMessage(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, task?.id, dirty, onCandidatesChanged]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [refresh]);

  // AI analysis runs in small batches while its state is "running" (the heartbeat also advances it when this page is closed).
  useEffect(() => {
    if (!task || task.aiState !== "running" || aiLoop.current) return;
    aiLoop.current = true;
    (async () => {
      try {
        for (let i = 0; i < 200; i++) {
          const r = await hunt.aiRun(task.id);
          onCandidatesChanged();
          if (r.state !== "running" || r.remaining === 0) break;
          await new Promise((res) => setTimeout(res, 300));
        }
      } catch (e) {
        setError(toMessage(e));
      } finally {
        aiLoop.current = false;
        void refresh();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.aiState, task?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
  };
  const saveFilters = () => run("save", async () => {
    if (!task || !filters || !limits) return;
    await hunt.saveTask(task.id, { filters, limits });
    setDirty(false);
  });
  const applyFilters = () => run("apply", async () => {
    if (!task || !filters || !limits) return;
    if (dirty) { await hunt.saveTask(task.id, { filters, limits }); setDirty(false); }
    await hunt.command(task.id, "apply_filters");
    setWaiting("apply_filters");
  });
  const checkSession = () => run("check", async () => { if (task) { await hunt.command(task.id, "check_session"); setWaiting("check_session"); } });

  const connected = conn?.connected === true;
  const naukri = NAUKRI_TEXT[conn?.naukri ?? "unknown"] ?? NAUKRI_TEXT.unknown!;
  const ready = connected && conn?.naukri === "signed_in";
  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const statusOf = (key: string) => task?.filterReport?.[key];
  const configured = new Set(task?.configured ?? []);

  const sourcingControls = (s: RunState) => ({
    start: s === "idle" || s === "stopped" || s === "completed",
    pause: s === "running",
    resume: s === "paused",
    stop: s === "running" || s === "paused",
  });
  const aiControls = (s: RunState) => ({ start: s === "idle" || s === "stopped" || s === "completed", pause: s === "running", resume: s === "paused", stop: s === "running" || s === "paused" });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label="Find candidates on Naukri" className="flex h-full w-full max-w-3xl flex-col bg-zinc-50 shadow-2xl">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Find Candidates on Naukri</h2>
            <p className="text-xs text-zinc-600">Your signed-in Resdex session does the browsing. XS-Hunt controls it and keeps what it finds.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100"><X className="size-5" aria-hidden="true" /></button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && <Notice>{error}</Notice>}
          {task === undefined && <Skeleton className="h-40" />}

          {/* 1. connection */}
          <Card className="space-y-2 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-950"><PlugZap className="size-4 text-accent" aria-hidden="true" /> 1. Extension and Naukri session</h3>
            {conn === null ? <Skeleton className="h-10" /> : (
              <ul className="space-y-1.5 text-sm">
                <li className="flex flex-wrap items-center gap-2">
                  {connected ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" /> : <XCircle className="size-4 text-rose-600" aria-hidden="true" />}
                  {conn.state === "connected" && <span>Extension connected{conn.version ? ` (v${conn.version})` : ""}, last heartbeat {ago(conn.lastSeenAt)}.</span>}
                  {conn.state === "disconnected" && <span>Extension <b>not connected</b>: last heard {ago(conn.lastSeenAt)}. Open Chrome with the XS-Hunt extension and make sure it is logged in.</span>}
                  {conn.state === "never" && <span>No extension has connected to your account yet. Install the XS-Hunt extension, enter this site&apos;s address and log in with your XS-Hunt email and password.</span>}
                </li>
                <li className="flex flex-wrap items-center gap-2">
                  {connected ? (naukri.tone === "green" ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" /> : <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />) : <CircleDashed className="size-4 text-zinc-400" aria-hidden="true" />}
                  <span>{connected ? naukri.text : "Naukri session unknown while the extension is offline."}</span>
                  {connected && conn.naukriCheckedAt && <span className="text-xs text-zinc-500">checked {ago(conn.naukriCheckedAt)}</span>}
                </li>
              </ul>
            )}
            <Button size="sm" onClick={() => void checkSession()} disabled={!connected || !canEdit || !task} loading={busy === "check" || waiting === "check_session"}><RefreshCw className="size-3.5" aria-hidden="true" /> Check session now</Button>
          </Card>

          {task === null && (
            <Card className="p-5 text-center">
              <p className="text-sm text-zinc-700">No Naukri sourcing task exists for this job yet. Filters start from the job description; you review them before anything runs.</p>
              <Button className="mt-3" variant="primary" disabled={!canEdit} loading={busy === "new"} onClick={() => void run("new", async () => { const r = await hunt.newTask(jobId); setTask(r.task); setFilters(r.task.filters); setLimits(r.task.limits); })}>Create sourcing task</Button>
            </Card>
          )}

          {task && filters && limits && (
            <>
              {/* 2. filters */}
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-950">2. Naukri search filters</h3>
                  <span className="text-xs text-zinc-500">Search filters only. How candidates are judged is set separately in the Rubric tab.</span>
                </div>
                <Field label="Boolean query" status={statusOf("boolean")} unmapped={false}>
                  <textarea className="min-h-16 w-full rounded-lg border border-zinc-200 p-2 text-sm focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-zinc-50" disabled={!canEdit} value={filters.boolean} onChange={(e) => set("boolean", e.target.value)} aria-label="Boolean query" />
                  <label className="mt-1 flex items-center gap-2 text-xs text-zinc-600"><input type="checkbox" className="accent-[#4f46e5]" checked={filters.useBoolean} onChange={(e) => set("useBoolean", e.target.checked)} /> Switch Resdex to Boolean mode</label>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Keywords (all of)" status={statusOf("keywords")} unmapped={false}><ChipInput label="" values={filters.keywords} onChange={(v) => set("keywords", v)} placeholder="Add keyword" /></Field>
                  <Field label="Keywords (any of)" status={statusOf("anyKeywords")} unmapped={false}><ChipInput label="" values={filters.anyKeywords} onChange={(v) => set("anyKeywords", v)} placeholder="Add keyword" /></Field>
                  <Field label="Exclude keywords" status={statusOf("excludeKeywords")} unmapped={false}><ChipInput label="" values={filters.excludeKeywords} onChange={(v) => set("excludeKeywords", v)} placeholder="Add keyword" /></Field>
                  <Field label="Current designation" status={statusOf("designation")} unmapped={false}><ChipInput label="" values={filters.designation} onChange={(v) => set("designation", v)} placeholder="e.g. Senior SRE" /></Field>
                  <Field label="Previous designation" status={statusOf("previousDesignation")} unmapped><ChipInput label="" values={filters.previousDesignation} onChange={(v) => set("previousDesignation", v)} placeholder="Add designation" /></Field>
                  <Field label="Current location" status={statusOf("location")} unmapped={false}><ChipInput label="" values={filters.location} onChange={(v) => set("location", v)} placeholder="e.g. Hyderabad" /></Field>
                  <Field label="Preferred location" status={statusOf("preferredLocation")} unmapped><ChipInput label="" values={filters.preferredLocation} onChange={(v) => set("preferredLocation", v)} placeholder="Add city" /></Field>
                  <Field label="Current company" status={statusOf("currentCompany")} unmapped><ChipInput label="" values={filters.currentCompany} onChange={(v) => set("currentCompany", v)} placeholder="Add company" /></Field>
                  <Field label="Industry" status={statusOf("industry")} unmapped><ChipInput label="" values={filters.industry} onChange={(v) => set("industry", v)} placeholder="Add industry" /></Field>
                  <Field label="Education" status={statusOf("education")} unmapped={false}><input className={inputClass} disabled={!canEdit} value={filters.education} onChange={(e) => set("education", e.target.value)} placeholder="e.g. B.Tech" aria-label="Education" /></Field>
                  <Field label="University" status={statusOf("university")} unmapped><ChipInput label="" values={filters.university} onChange={(v) => set("university", v)} placeholder="Add university" /></Field>
                  <Field label="Notice period (max days)" status={statusOf("notice")} unmapped={false}><input className={inputClass} inputMode="numeric" disabled={!canEdit} value={filters.notice ?? ""} onChange={(e) => set("notice", num(e.target.value))} aria-label="Maximum notice period in days" /></Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Min experience (yrs)" status={statusOf("minExp")} unmapped={false}><input className={inputClass} inputMode="decimal" disabled={!canEdit} value={filters.minExp ?? ""} onChange={(e) => set("minExp", num(e.target.value))} aria-label="Minimum experience" /></Field>
                  <Field label="Max experience (yrs)" status={statusOf("maxExp")} unmapped={false}><input className={inputClass} inputMode="decimal" disabled={!canEdit} value={filters.maxExp ?? ""} onChange={(e) => set("maxExp", num(e.target.value))} aria-label="Maximum experience" /></Field>
                  <Field label="Current CTC min (LPA)" status={statusOf("minSalary")} unmapped={false}><input className={inputClass} inputMode="decimal" disabled={!canEdit} value={filters.minSalary ?? ""} onChange={(e) => set("minSalary", num(e.target.value))} aria-label="Minimum current CTC" /></Field>
                  <Field label="Current CTC max (LPA)" status={statusOf("maxSalary")} unmapped={false}><input className={inputClass} inputMode="decimal" disabled={!canEdit} value={filters.maxSalary ?? ""} onChange={(e) => set("maxSalary", num(e.target.value))} aria-label="Maximum current CTC" /></Field>
                  <Field label="Expected CTC min (LPA)" status={statusOf("expectedMinSalary")} unmapped><input className={inputClass} inputMode="decimal" disabled={!canEdit} value={filters.expectedMinSalary ?? ""} onChange={(e) => set("expectedMinSalary", num(e.target.value))} aria-label="Minimum expected CTC" /></Field>
                  <Field label="Expected CTC max (LPA)" status={statusOf("expectedMaxSalary")} unmapped><input className={inputClass} inputMode="decimal" disabled={!canEdit} value={filters.expectedMaxSalary ?? ""} onChange={(e) => set("expectedMaxSalary", num(e.target.value))} aria-label="Maximum expected CTC" /></Field>
                </div>
                <p className="text-xs text-zinc-500">Fields marked <Badge>Set on Naukri</Badge> are kept here for your reference, but this extension version cannot type them into Resdex, so they are reported as Unsupported. Nothing is shown as applied until the extension has read the value back from Naukri.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void saveFilters()} disabled={!canEdit || !dirty} loading={busy === "save"}>Save filters</Button>
                  <Button variant="primary" onClick={() => void applyFilters()} disabled={!canEdit || !ready || task.sourcingState === "running"} loading={busy === "apply" || waiting === "apply_filters"} title={!ready ? "Needs a connected extension and a signed-in Naukri session" : undefined}>Apply Search Filters</Button>
                  {waiting === "apply_filters" && <span className="text-xs text-zinc-600">Waiting for the extension to type the filters and read them back…</span>}
                  {task.filtersAppliedAt && !waiting && <span className="text-xs text-zinc-600">Last applied {ago(task.filtersAppliedAt)}.</span>}
                </div>
                {Object.keys(task.filterReport).length > 0 && (
                  <ul className="grid gap-1 text-xs sm:grid-cols-2" aria-label="Filter results from Naukri">
                    {Object.entries(task.filterReport).filter(([k]) => configured.has(k) || !MAPPED.has(k)).map(([k, v]) => (
                      <li key={k} className="flex items-start gap-1.5 rounded-md bg-white px-2 py-1 ring-1 ring-zinc-200">
                        <Badge tone={FIELD_STATUS[v.status].tone}>{FIELD_STATUS[v.status].text}</Badge>
                        <span className="min-w-0"><b>{k}</b>{v.detail ? <span className="text-zinc-600">: {v.detail}</span> : null}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* 3. limits */}
              <Card className="space-y-2 p-4">
                <h3 className="text-sm font-semibold text-zinc-950">3. How far to go</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Result pages" unmapped={false}><input className={inputClass} inputMode="numeric" disabled={!canEdit || task.sourcingState === "running"} value={limits.maxPages} onChange={(e) => { setLimits({ ...limits, maxPages: Math.max(1, Math.min(50, Number(e.target.value) || 1)) }); setDirty(true); }} aria-label="Pages to read" /></Field>
                  <Field label="Max candidates" unmapped={false}><input className={inputClass} inputMode="numeric" disabled={!canEdit || task.sourcingState === "running"} value={limits.maxCandidates} onChange={(e) => { setLimits({ ...limits, maxCandidates: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) }); setDirty(true); }} aria-label="Maximum candidates" /></Field>
                  <Field label="Pause between pages (s)" unmapped={false}><input className={inputClass} inputMode="numeric" disabled={!canEdit || task.sourcingState === "running"} value={limits.delaySeconds} onChange={(e) => { setLimits({ ...limits, delaySeconds: Math.max(3, Math.min(60, Number(e.target.value) || 3)) }); setDirty(true); }} aria-label="Seconds between pages" /></Field>
                </div>
                <p className="text-xs text-zinc-500">Sourcing only reads result pages you could read yourself. It never opens a profile. The pause makes the session behave like a person paging through results.</p>
              </Card>

              {/* 4. controls */}
              <div className="grid gap-4 md:grid-cols-2">
                <ControlCard title="Sourcing" subtitle="Reads candidate cards from Naukri result pages" state={task.sourcingState} controls={sourcingControls(task.sourcingState)} canEdit={canEdit} busy={busy}
                  onAction={(a) => void run(`s-${a}`, () => hunt.sourcing(task.id, a, skipFilters))}
                  blockedReason={task.sourcingState !== "running" && !task.filtersAppliedAt && !skipFilters ? "Apply the filters first so you can review them on Naukri." : !ready ? "Needs a connected extension and a signed-in Naukri session." : null}>
                  <ProgressBar value={task.counters.pagesDone} max={task.limits.maxPages} label="Pages read" />
                  <p className="mt-1 text-xs tabular-nums text-zinc-600">{task.counters.pagesDone} of {task.limits.maxPages} pages · {task.counters.captured} of {task.limits.maxCandidates} candidates · {task.counters.duplicates} already known</p>
                  {!task.filtersAppliedAt && task.sourcingState !== "running" && (
                    <label className="mt-2 flex items-start gap-2 text-xs text-zinc-600"><input type="checkbox" className="mt-0.5 accent-[#4f46e5]" checked={skipFilters} onChange={(e) => setSkipFilters(e.target.checked)} /> I already set the filters on Naukri myself; start from what its page shows.</label>
                  )}
                </ControlCard>
                <ControlCard title="AI analysis" subtitle="Scores captured candidates against the job's rubric" state={task.aiState} controls={aiControls(task.aiState)} canEdit={canEdit} busy={busy}
                  onAction={(a) => void run(`a-${a}`, () => hunt.ai(task.id, a))} blockedReason={null}>
                  <ProgressBar value={task.counters.analyzed} max={Math.max(task.counters.captured, 1)} tone="green" label="Candidates analysed" />
                  <p className="mt-1 text-xs tabular-nums text-zinc-600">{task.counters.analyzed} analysed · {task.counters.aiPending} waiting · {task.counters.aiFailed} failed</p>
                  <p className="mt-1 text-xs text-zinc-500">Collect first, analyse later, or both at once: the two controls are independent. Rubric v{task.rubricVersion ?? "?"}.</p>
                </ControlCard>
              </div>

              {task.lastError && <Notice>{task.lastError}</Notice>}

              <Card className="p-4">
                <h3 className="mb-2 text-sm font-semibold text-zinc-950">Activity</h3>
                <ul className="max-h-56 space-y-1 overflow-auto text-xs">
                  {task.events.map((e) => (
                    <li key={e.id} className="flex gap-2"><span className="w-16 shrink-0 tabular-nums text-zinc-400">{new Date(e.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><span className={e.kind === "error" ? "text-rose-700" : e.kind === "warning" ? "text-amber-700" : "text-zinc-700"}>{e.message}</span></li>
                  ))}
                  {task.events.length === 0 && <li className="text-zinc-500">Nothing yet.</li>}
                </ul>
              </Card>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Field({ label, status, unmapped, children }: { label: string; status?: { status: FieldStatus; detail?: string }; unmapped: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-700">{label}</span>
        {status ? <Badge tone={FIELD_STATUS[status.status].tone} title={status.detail}>{FIELD_STATUS[status.status].text}</Badge> : unmapped ? <Badge title="This extension version cannot fill this into Resdex">Set on Naukri</Badge> : null}
      </div>
      {children}
    </div>
  );
}

function ControlCard({ title, subtitle, state, controls, canEdit, busy, onAction, blockedReason, children }: { title: string; subtitle: string; state: RunState; controls: { start: boolean; pause: boolean; resume: boolean; stop: boolean }; canEdit: boolean; busy: string | null; onAction: (a: "start" | "pause" | "resume" | "stop") => void; blockedReason: string | null; children: React.ReactNode }) {
  const tone = state === "running" ? "green" : state === "paused" ? "amber" : state === "completed" ? "indigo" : "neutral";
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">{title}</h3>
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
        <Badge tone={tone}>{state}</Badge>
      </div>
      {children}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button size="sm" variant="success" disabled={!canEdit || !controls.start || blockedReason !== null} onClick={() => onAction("start")} loading={busy?.endsWith("-start")}><Play className="size-3.5" aria-hidden="true" /> Start</Button>
        <Button size="sm" disabled={!canEdit || !controls.pause} onClick={() => onAction("pause")} loading={busy?.endsWith("-pause")}><Pause className="size-3.5" aria-hidden="true" /> Pause</Button>
        <Button size="sm" disabled={!canEdit || !controls.resume} onClick={() => onAction("resume")} loading={busy?.endsWith("-resume")}><Play className="size-3.5" aria-hidden="true" /> Resume</Button>
        <Button size="sm" variant="danger" disabled={!canEdit || !controls.stop} onClick={() => onAction("stop")} loading={busy?.endsWith("-stop")}><Square className="size-3.5" aria-hidden="true" /> Stop</Button>
      </div>
      {blockedReason && controls.start && <p className="text-xs text-amber-700">{blockedReason}</p>}
    </Card>
  );
}
