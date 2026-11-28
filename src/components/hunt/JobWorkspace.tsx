"use client";

import { ChevronDown, FileSearch, GitCompareArrows, Kanban, Pencil, Radar, Search, SlidersHorizontal, UserSearch } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useIngestion } from "@/hooks/useIngestion";
import { useRole } from "@/hooks/useRole";
import { api, toMessage } from "@/lib/api";
import { hunt, SOURCE_LABEL, STAGES, STAGE_LABEL, TIER_LABEL, type CandidateRow, type ConnectionView } from "@/lib/hunt";
import type { IntegrationDto, JobDetailDto } from "@/lib/types";
import { IngestionStatus } from "../IngestionStatus";
import { SourcingDialog } from "../SourcingDialog";
import { CandidateCard } from "./CandidateCard";
import { CandidateDrawer } from "./CandidateDrawer";
import { CompareDialog, RejectDialog, RetrievalDialog } from "./Dialogs";
import { ExtensionStrip } from "./ExtensionStrip";
import { FindCandidatesPanel } from "./FindCandidatesPanel";
import { RubricEditor } from "./RubricEditor";
import { Badge, Button, Card, Empty, inputClass, Notice, PageHeader, Skeleton } from "./ui";
import { Modal } from "../Modal";
import { ChipInput } from "../ChipInput";

type Tab = "candidates" | "rubric";
const PLATFORMS = ["naukri", "linkedin", "github", "cutshort"] as const;
const TOGGLE_KEY = "xshunt:platforms";

export function JobWorkspace({ jobId }: { jobId: string }) {
  const { canEdit } = useRole();
  const [job, setJob] = useState<JobDetailDto | null>(null);
  const [tab, setTab] = useState<Tab>("candidates");
  const [source, setSource] = useState<string>("all");
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [tier, setTier] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [drawer, setDrawer] = useState<{ row: CandidateRow; tab: "overview" | "notes" | "resume" } | null>(null);
  const [reject, setReject] = useState<CandidateRow | null>(null);
  const [compare, setCompare] = useState(false);
  const [retrieve, setRetrieve] = useState(false);
  const [panel, setPanel] = useState(false);
  const [classic, setClassic] = useState(false);
  const [menu, setMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editJd, setEditJd] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationDto[]>([]);
  const [conn, setConn] = useState<ConnectionView | null>(null);
  const [enabled, setEnabled] = useState<string[]>(["naukri"]);
  const ingestion = useIngestion(jobId, () => void load());

  const load = useCallback(async () => {
    try {
      const r = await hunt.candidates(jobId, { limit: 300 });
      setRows(r.rows);
      setTotal(r.total);
      setError(null);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    api.getJob(jobId).then((r) => setJob(r.job)).catch((e: unknown) => setError(toMessage(e)));
    api.listIntegrations().then((r) => setIntegrations(r.integrations)).catch(() => {});
    void load();
    try { const saved = JSON.parse(window.localStorage.getItem(TOGGLE_KEY) ?? "null"); if (Array.isArray(saved)) setEnabled(saved.filter((s: string) => (PLATFORMS as readonly string[]).includes(s))); } catch { /* defaults */ }
  }, [jobId, load]);
  useEffect(() => {
    const t = setInterval(() => hunt.connection().then(setConn).catch(() => {}), 5000);
    hunt.connection().then(setConn).catch(() => {});
    return () => clearInterval(t);
  }, []);
  // While the extension is connected, new candidates from Naukri show up here without a refresh.
  useEffect(() => {
    if (!conn?.connected) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 6000);
    return () => clearInterval(t);
  }, [conn?.connected, load]);

  const works = (id: string): boolean => {
    if (id === "naukri") return true; // the extension integration is real; its live state is shown next to the toggle
    return integrations.find((i) => i.id === id)?.status === "connected";
  };
  const toggle = (id: string) => {
    const next = enabled.includes(id) ? enabled.filter((x) => x !== id) : [...enabled, id];
    setEnabled(next);
    try { window.localStorage.setItem(TOGGLE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const s of PLATFORMS) c[s] = rows.filter((r) => r.sources.includes(s)).length;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => source === "all" || r.sources.includes(source))
      .filter((r) => !stage || r.stage === stage)
      .filter((r) => !tier || r.tier === tier)
      .filter((r) => !needle || [r.name, r.headline, r.location, ...r.matchedSkills].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [rows, source, stage, tier, q]);
  const rankOf = useMemo(() => new Map(rows.filter((r) => r.score !== null).map((r, i) => [r.matchId, i + 1])), [rows]);
  const chosen = rows.filter((r) => selected.includes(r.matchId));

  async function setStageOf(row: CandidateRow, to: string, reason?: string) {
    try {
      await hunt.act(row.matchId, { action: "stage", to, ...(reason ? { reason } : {}) });
      await load();
    } catch (e) {
      setError(toMessage(e));
    }
  }
  const toggleSelect = (id: string, on: boolean) => setSelected((s) => (on ? (s.includes(id) ? s : [...s, id]) : s.filter((x) => x !== id)));

  const naukriNote = conn ? (conn.connected ? (conn.naukri === "signed_in" ? "extension connected, Naukri signed in" : `extension connected, Naukri ${conn.naukri.replace("_", " ")}`) : conn.state === "never" ? "extension not installed or never connected" : "extension offline") : "checking…";

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={job?.title ?? "Loading…"}
        subtitle={job ? `${job.locations.join(", ") || "Location not set"}${job.experienceYears ? ` · ${job.experienceYears}+ yrs` : ""}` : undefined}
        actions={
          <>
            <Button onClick={() => setEditJd(true)} disabled={!canEdit || !job}><Pencil className="size-3.5" aria-hidden="true" /> Edit JD</Button>
            <Link href={`/pipeline?job=${jobId}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 text-sm font-medium hover:bg-zinc-50"><Kanban className="size-3.5" aria-hidden="true" /> Pipeline</Link>
            <Link href={`/resume-match?job=${jobId}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 text-sm font-medium hover:bg-zinc-50"><FileSearch className="size-3.5" aria-hidden="true" /> Resume Match</Link>
            <div className="relative">
              <Button variant="primary" onClick={() => setMenu((m) => !m)} disabled={!canEdit} aria-haspopup="menu" aria-expanded={menu}><Radar className="size-3.5" aria-hidden="true" /> Find Candidates <ChevronDown className="size-3.5" aria-hidden="true" /></Button>
              {menu && (
                <div role="menu" className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
                  {enabled.includes("naukri") && <button role="menuitem" className="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-zinc-50" onClick={() => { setMenu(false); setPanel(true); }}><span className="text-sm font-medium text-zinc-950">Naukri (your Resdex session)</span><span className="text-xs text-zinc-500">{naukriNote}</span></button>}
                  {enabled.some((s) => s !== "naukri") && <button role="menuitem" className="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-zinc-50" onClick={() => { setMenu(false); setClassic(true); }}><span className="text-sm font-medium text-zinc-950">{enabled.filter((s) => s !== "naukri").map((s) => SOURCE_LABEL[s]).join(" / ")} search</span><span className="text-xs text-zinc-500">Searches public profiles from this platform</span></button>}
                  {enabled.length === 0 && <p className="px-3 py-2 text-xs text-zinc-500">Turn on at least one sourcing platform below.</p>}
                </div>
              )}
            </div>
          </>
        }
      />
      <ExtensionStrip jobId={jobId} conn={conn} canEdit={canEdit} captured={rows.filter((r) => r.sources.includes("naukri")).length} />

      {/* description */}
      {job && (
        <Card className="p-4">
          <p className={`whitespace-pre-line text-sm text-zinc-700 ${expanded ? "" : "line-clamp-3"}`}>{job.description || "No description."}</p>
          <button type="button" className="mt-1 text-xs font-medium text-accent hover:underline" onClick={() => setExpanded((v) => !v)}>{expanded ? "Collapse JD" : "Expand JD"}</button>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-100 pt-3">
            <span className="text-xs font-medium text-zinc-600">Sourcing platforms</span>
            {PLATFORMS.map((id) => {
              const ok = works(id);
              return (
                <label key={id} className={`flex items-center gap-1.5 text-sm ${ok ? "text-zinc-800" : "text-zinc-400"}`} title={ok ? undefined : "Not connected. Set it up under Integrations."}>
                  <input type="checkbox" className="size-4 accent-[#4f46e5]" checked={enabled.includes(id)} disabled={!ok} onChange={() => toggle(id)} aria-label={`Use ${SOURCE_LABEL[id]} for sourcing`} />
                  {SOURCE_LABEL[id]}
                  {id === "naukri" && <span className={`size-1.5 rounded-full ${conn?.connected ? (conn.naukri === "signed_in" ? "bg-emerald-500" : "bg-amber-500") : "bg-zinc-300"}`} aria-hidden="true" />}
                </label>
              );
            })}
            <span className="text-xs text-zinc-500">{naukriNote}</span>
          </div>
        </Card>
      )}

      {(ingestion.isActive || ingestion.batch?.status === "failed") && <IngestionStatus batch={ingestion.batch} isActive={ingestion.isActive} isStarting={ingestion.isStarting} failedMatchCount={0} quickScoreCount={0} onStart={() => setClassic(true)} onRetryFailed={() => void ingestion.start({ rescoreOnly: true })} onControl={(a) => void ingestion.control(a)} />}

      {error && <Notice>{error}</Notice>}

      <nav role="tablist" aria-label="Job sections" className="flex gap-1 border-b border-zinc-200">
        {([["candidates", "Candidates", UserSearch], ["rubric", "Evaluation rubric", SlidersHorizontal]] as const).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm ${tab === id ? "border-accent font-medium text-accent" : "border-transparent text-zinc-600 hover:text-zinc-950"}`}><Icon className="size-4" aria-hidden="true" /> {label}</button>
        ))}
      </nav>

      {tab === "rubric" && <RubricEditor jobId={jobId} canEdit={canEdit} onSaved={() => void load()} />}

      {tab === "candidates" && (
        <>
          {/* candidate source tabs: independent of the sourcing toggles above */}
          <div role="tablist" aria-label="Candidate source" className="flex flex-wrap gap-1.5">
            {[["all", "All Candidates"], ...PLATFORMS.map((p) => [p, SOURCE_LABEL[p]!])].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={source === id} type="button" onClick={() => setSource(id!)} className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm ${source === id ? "border-accent bg-accent/5 font-medium text-accent" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"}`}>
                {label} <span className="tabular-nums text-xs text-zinc-500">{counts[id!] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 min-w-56 flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 sm:max-w-sm">
              <Search className="size-4 text-zinc-500" aria-hidden="true" />
              <span className="sr-only">Search candidates</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, role, skill, city" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400" />
            </label>
            <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Filter by match tier" className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm">
              <option value="">All tiers</option>
              {Object.entries(TIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filter by stage" className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm">
              <option value="">All stages</option>
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
            <span className="text-xs tabular-nums text-zinc-500">{visible.length} shown{total > rows.length ? ` · first ${rows.length} of ${total}` : ""}</span>
          </div>

          {selected.length > 0 && (
            <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-white p-2 shadow-md">
              <Badge tone="indigo">{selected.length} selected</Badge>
              <Button size="sm" variant="primary" disabled={selected.length < 2 || selected.length > 5} onClick={() => setCompare(true)} title="Pick 2 to 5"><GitCompareArrows className="size-3.5" aria-hidden="true" /> Compare{selected.length > 5 ? " (max 5)" : ""}</Button>
              <Button size="sm" disabled={!canEdit} onClick={() => setRetrieve(true)}>Get profile &amp; resume</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
            </div>
          )}

          {loading ? (
            <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44" />)}</div>
          ) : visible.length === 0 ? (
            <Empty title={rows.length === 0 ? "No candidates yet" : "No candidates match these filters"} icon={<UserSearch className="size-8" aria-hidden="true" />}>
              {rows.length === 0 ? <>Use <b>Find Candidates</b> to source from Naukri through your extension, or from the other connected platforms.</> : "Clear the search or filters to see everyone again."}
            </Empty>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {visible.map((r) => (
                <CandidateCard key={r.matchId} row={r} rank={rankOf.get(r.matchId) ?? null} selected={selected.includes(r.matchId)} canEdit={canEdit} onSelect={toggleSelect}
                  onShortlist={(row) => void setStageOf(row, row.shortlisted ? "screening" : "shortlisted")}
                  onStage={(row, to) => void setStageOf(row, to)} onReject={setReject} onOpen={(row, t) => setDrawer({ row, tab: t ?? "overview" })} onChanged={() => void load()} />
              ))}
            </div>
          )}
        </>
      )}

      {panel && <FindCandidatesPanel jobId={jobId} canEdit={canEdit} onClose={() => setPanel(false)} onCandidatesChanged={() => void load()} />}
      {drawer && <CandidateDrawer matchId={drawer.row.matchId} candidateId={drawer.row.candidateId} initialTab={drawer.tab} canEdit={canEdit} onClose={() => setDrawer(null)} onChanged={() => void load()} />}
      <RejectDialog row={reject} onClose={() => setReject(null)} onConfirm={async (reason) => { if (reject) await setStageOf(reject, "rejected", reason); }} />
      <CompareDialog open={compare} jobId={jobId} ids={selected} onClose={() => setCompare(false)} />
      <RetrievalDialog open={retrieve} jobId={jobId} rows={chosen} onClose={() => setRetrieve(false)} onDone={() => { setSelected([]); void load(); }} />
      <SourcingDialog open={classic} onClose={() => setClassic(false)} purpose="sourcing" jobId={jobId} onSearchCurrent={(o) => ingestion.start(o)} onJobUpdated={() => api.getJob(jobId).then((r) => setJob(r.job))} onJobCreated={() => undefined} />
      {job && <EditJd open={editJd} job={job} onClose={() => setEditJd(false)} onSaved={(j) => { setJob(j); setEditJd(false); }} />}
    </div>
  );
}

function EditJd({ open, job, onClose, onSaved }: { open: boolean; job: JobDetailDto; onClose: () => void; onSaved: (j: JobDetailDto) => void }) {
  const [d, setD] = useState(job);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setD(job); setError(null); } }, [open, job]);
  return (
    <Modal open={open} onClose={onClose} title="Edit job description" description="Changing the JD does not change the evaluation rubric. Edit that in its own tab." widthClass="max-w-2xl">
      <div className="space-y-3">
        <input className={inputClass} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} aria-label="Job title" />
        <textarea className="min-h-40 w-full rounded-lg border border-zinc-200 p-2 text-sm focus:border-accent focus:ring-2 focus:ring-accent/20" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} aria-label="Job description" />
        <div className="grid gap-3 sm:grid-cols-2">
          <ChipInput label="Required skills" values={d.requiredSkills} onChange={(v) => setD({ ...d, requiredSkills: v })} />
          <ChipInput label="Preferred skills" values={d.preferredSkills} onChange={(v) => setD({ ...d, preferredSkills: v })} />
          <ChipInput label="Locations" values={d.locations} onChange={(v) => setD({ ...d, locations: v })} />
          <label className="block text-xs font-medium text-zinc-700">Experience (years)<input className={`${inputClass} mt-1`} inputMode="decimal" value={d.experienceYears ?? ""} onChange={(e) => setD({ ...d, experienceYears: e.target.value === "" ? null : Number(e.target.value) })} /></label>
        </div>
        {error && <Notice>{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); setError(null); try { const r = await api.updateJob(job.id, { title: d.title, description: d.description, requiredSkills: d.requiredSkills, preferredSkills: d.preferredSkills, locations: d.locations, experienceYears: d.experienceYears }); onSaved(r.job); } catch (e) { setError(toMessage(e)); } finally { setBusy(false); } }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
