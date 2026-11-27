"use client";

import { LayoutList, Kanban } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useJobs } from "@/hooks/useJobs";
import { useRole } from "@/hooks/useRole";
import { toMessage } from "@/lib/api";
import { hunt, STAGES, STAGE_LABEL, type CandidateRow } from "@/lib/hunt";
import { ScoreRing } from "../ScoreRing";
import { CandidateDrawer } from "./CandidateDrawer";
import { RejectDialog } from "./Dialogs";
import { Avatar, Badge, Empty, Notice, PageHeader, Skeleton, SourceBadge, TierBadge } from "./ui";

const COL_TONE: Record<string, string> = { hired: "border-t-emerald-500", rejected: "border-t-rose-400", offer: "border-t-indigo-500" };

/** The eleven-stage ATS pipeline of one job: list or drag-and-drop Kanban, with live stage counts. Every move is saved and audited. */
export function PipelineView({ initialJobId, pending }: { initialJobId: string | null; pending: boolean }) {
  const { canEdit } = useRole();
  const { jobs, status } = useJobs();
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [open, setOpen] = useState<CandidateRow | null>(null);
  const [reject, setReject] = useState<CandidateRow | null>(null);

  useEffect(() => { if (!jobId && jobs[0]) setJobId(jobs[0].id); }, [jobs, jobId]);
  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      setRows((await hunt.candidates(jobId, { limit: 300 })).rows);
      setError(null);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  }, [jobId]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => (pending ? rows.filter((r) => ["new", "sourced", "screening"].includes(r.stage)) : rows), [rows, pending]);
  const byStage = useMemo(() => {
    const m = new Map<string, CandidateRow[]>(STAGES.map((s) => [s, []]));
    for (const r of shown) (m.get(r.stage) ?? m.get("new")!).push(r);
    return m;
  }, [shown]);

  async function move(row: CandidateRow, to: string, reason?: string) {
    if (row.stage === to) return;
    const before = rows;
    setRows((rs) => rs.map((r) => (r.matchId === row.matchId ? { ...r, stage: to, shortlisted: ["shortlisted", "contacted", "interview_scheduled", "interviewed", "assessment", "offer", "hired"].includes(to) } : r))); // optimistic
    try {
      await hunt.act(row.matchId, { action: "stage", to, ...(reason ? { reason } : {}) });
      void load();
    } catch (e) {
      setRows(before);
      setError(toMessage(e));
    }
  }

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Pipeline"
        subtitle={pending ? "Candidates still waiting for a first decision (New, Sourced, Screening)." : "Drag candidates between the eleven stages. Every move is recorded."}
        actions={
          <>
            <select value={jobId ?? ""} onChange={(e) => setJobId(e.target.value)} aria-label="Job" className="h-9 max-w-64 rounded-lg border border-zinc-200 bg-white px-2 text-sm">
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
            <div role="group" aria-label="View" className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
              {([["kanban", "Kanban", Kanban], ["list", "List", LayoutList]] as const).map(([id, label, Icon]) => (
                <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-sm ${view === id ? "bg-accent text-white" : "text-zinc-600 hover:text-zinc-950"}`}><Icon className="size-3.5" aria-hidden="true" /> {label}</button>
              ))}
            </div>
          </>
        }
      />
      {error && <Notice>{error}</Notice>}
      {status === "ready" && jobs.length === 0 && <Empty title="No jobs yet">Create a job first; its candidates then move through the pipeline here.</Empty>}
      {loading && rows.length === 0 && <Skeleton className="h-64" />}

      {jobId && view === "kanban" && (
        <div className="flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Pipeline stages">
          {STAGES.map((s) => {
            const list = byStage.get(s) ?? [];
            return (
              <section key={s} role="listitem" aria-label={`${STAGE_LABEL[s]}, ${list.length} candidates`}
                onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(s); } }} onDragLeave={() => setOver((o) => (o === s ? null : o))}
                onDrop={(e) => { e.preventDefault(); setOver(null); const row = rows.find((r) => r.matchId === dragId); setDragId(null); if (!row || !canEdit) return; if (s === "rejected") setReject(row); else void move(row, s); }}
                className={`flex w-64 shrink-0 flex-col rounded-xl border border-t-4 bg-zinc-100/60 ${COL_TONE[s] ?? "border-t-zinc-300"} ${over === s ? "border-accent bg-accent/5" : "border-zinc-200"}`}>
                <header className="flex items-center justify-between px-3 py-2">
                  <h2 className="text-sm font-semibold text-zinc-900">{STAGE_LABEL[s]}</h2>
                  <Badge>{list.length}</Badge>
                </header>
                <ul className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                  {list.map((r) => (
                    <li key={r.matchId} draggable={canEdit} onDragStart={() => setDragId(r.matchId)} onDragEnd={() => { setDragId(null); setOver(null); }}
                      className={`cursor-grab rounded-lg border border-zinc-200 bg-white p-2.5 shadow-sm hover:shadow ${dragId === r.matchId ? "opacity-50" : ""}`}>
                      <button type="button" onClick={() => setOpen(r)} className="flex w-full items-start gap-2 text-left">
                        <Avatar name={r.name} src={r.avatarUrl} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-950">{r.name}</span>
                          <span className="block truncate text-xs text-zinc-600">{r.headline}</span>
                        </span>
                        {r.score !== null && <ScoreRing score={r.score} size={32} />}
                      </button>
                      <div className="mt-1.5 flex flex-wrap gap-1"><TierBadge tier={r.tier} />{r.sources.map((x) => <SourceBadge key={x} source={x} size={12} />)}</div>
                      {!canEdit ? null : (
                        <label className="mt-1.5 block"><span className="sr-only">Move {r.name}</span>
                          <select value={r.stage} onChange={(e) => (e.target.value === "rejected" ? setReject(r) : void move(r, e.target.value))} className="h-7 w-full rounded-md border border-zinc-200 bg-white px-1 text-xs">
                            {STAGES.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}
                          </select>
                        </label>
                      )}
                    </li>
                  ))}
                  {list.length === 0 && <li className="px-1 py-3 text-center text-xs text-zinc-400">Empty</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {jobId && view === "list" && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-600"><tr><th className="p-2.5">Candidate</th><th>Source</th><th>Match</th><th>Stage</th><th>Updated</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.matchId} className="border-b border-zinc-100 hover:bg-zinc-50">
                  <td className="p-2.5"><button type="button" onClick={() => setOpen(r)} className="text-left"><span className="font-medium text-zinc-950">{r.name}</span><span className="block text-xs text-zinc-600">{r.headline}</span></button></td>
                  <td>{r.sources.map((x) => <SourceBadge key={x} source={x} size={12} />)}</td>
                  <td><span className="mr-1.5 font-semibold tabular-nums">{r.score ?? "n/a"}</span><TierBadge tier={r.tier} /></td>
                  <td>
                    <label><span className="sr-only">Stage of {r.name}</span>
                      <select disabled={!canEdit} value={r.stage} onChange={(e) => (e.target.value === "rejected" ? setReject(r) : void move(r, e.target.value))} className="h-8 rounded-md border border-zinc-200 bg-white px-1.5 text-sm disabled:opacity-60">{STAGES.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}</select>
                    </label>
                  </td>
                  <td className="text-xs tabular-nums text-zinc-500">{new Date(r.updatedAt).toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-sm text-zinc-500">No candidates in this job yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {open && <CandidateDrawer matchId={open.matchId} candidateId={open.candidateId} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={() => void load()} />}
      <RejectDialog row={reject} onClose={() => setReject(null)} onConfirm={async (reason) => { if (reject) await move(reject, "rejected", reason); }} />
    </div>
  );
}
