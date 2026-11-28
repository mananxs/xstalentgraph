"use client";

import { Download, ExternalLink, FileText, FileWarning, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toMessage } from "@/lib/api";
import { hunt, STAGES, STAGE_LABEL, type MatchDetail } from "@/lib/hunt";
import { WhyMatches } from "./WhyMatches";
import { Avatar, Badge, Button, inputClass, Notice, Skeleton, SourceBadge, TierBadge } from "./ui";

type Tab = "overview" | "notes" | "resume" | "activity";

const EVENT_TEXT: Record<string, string> = { stage: "Stage change", note: "Note added", override: "Score overridden", override_cleared: "Override removed", capture: "Captured from Naukri", evaluation: "Evaluated", rubric: "Rubric changed", rescore: "Re-evaluated", interview: "Interview scheduled", reminder: "Reminder set", resume_view: "Resume viewed", resume_download: "Resume downloaded" };

/** Everything about one candidate for one job, in a side panel. The resume opens here, from XS-Hunt's own storage. */
export function CandidateDrawer({ matchId, candidateId, initialTab = "overview", canEdit, onClose, onChanged }: { matchId: string; candidateId: string; initialTab?: Tab; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState("");
  const [remind, setRemind] = useState({ at: "", text: "" });
  const [resumeState, setResumeState] = useState<"checking" | "pdf" | "text" | "none">("checking");
  const [resumeText, setResumeText] = useState<string | null>(null);

  const load = useCallback(() => {
    hunt.match(matchId).then(setDetail).catch((e: unknown) => setError(toMessage(e)));
  }, [matchId]);
  useEffect(load, [load]);

  useEffect(() => {
    if (tab !== "resume") return;
    setResumeState("checking");
    fetch(`/api/candidates/${candidateId}/resume`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return setResumeState("none");
        if ((r.headers.get("content-type") ?? "").includes("pdf")) return setResumeState("pdf");
        if ((r.headers.get("content-type") ?? "").startsWith("text/")) {
          setResumeText(await r.text());
          return setResumeState("text");
        }
        setResumeState("pdf"); // other documents: offered as a download
      })
      .catch(() => setResumeState("none"));
  }, [tab, candidateId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function act(body: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await hunt.act(matchId, body);
      after?.();
      load();
      onChanged();
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const c = detail?.match.candidate;
  const tabs: Array<[Tab, string]> = [["overview", "Overview"], ["resume", "Resume"], ["notes", "Notes & interviews"], ["activity", "Activity"]];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label="Candidate details" className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b border-zinc-200 p-4">
          <Avatar name={c?.name ?? null} size={44} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-zinc-950">{c?.name ?? "Loading…"}</h2>
            <p className="truncate text-sm text-zinc-600">{c?.headline}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {c?.sources.map((s) => <SourceBadge key={s} source={s} />)}
              {detail?.evaluation && <TierBadge tier={detail.evaluation.tier} />}
              {detail && <Badge tone="indigo">{STAGE_LABEL[detail.match.stage as keyof typeof STAGE_LABEL] ?? detail.match.stage}</Badge>}
            </div>
            {(detail?.links ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detail!.links!.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white hover:bg-accent-strong">
                    <ExternalLink className="size-3.5" aria-hidden="true" /> Open on {l.source === "linkedin" ? "LinkedIn" : l.source === "naukri" ? "Naukri" : l.source === "github" ? "GitHub" : l.source}
                  </a>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100">
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <nav role="tablist" aria-label="Candidate sections" className="flex gap-1 border-b border-zinc-200 px-3">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-2.5 text-sm ${tab === id ? "border-accent font-medium text-accent" : "border-transparent text-zinc-600 hover:text-zinc-950"}`}>
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <div className="mb-3"><Notice>{error}</Notice></div>}
          {!detail && !error && <Skeleton className="h-48" />}

          {detail && tab === "overview" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="drawer-stage" className="text-sm text-zinc-700">Stage</label>
                <select id="drawer-stage" disabled={!canEdit || busy} value={detail.match.stage} onChange={(e) => (e.target.value === "rejected" ? setTab("notes") : void act({ action: "stage", to: e.target.value }))} className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm">
                  {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
                {detail.match.stage === "rejected" && <Badge tone="red">Rejected: {detail.match.rejectionReason}</Badge>}
              </div>
              <WhyMatches matchId={matchId} canEdit={canEdit} onChanged={() => { load(); onChanged(); }} />
            </div>
          )}

          {detail && tab === "resume" && (
            <div>
              {resumeState === "checking" && <Skeleton className="h-64" />}
              {resumeState === "pdf" && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium hover:bg-zinc-50" href={`/api/candidates/${candidateId}/resume?download=1`}><Download className="size-3.5" aria-hidden="true" /> Download</a>
                    <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium hover:bg-zinc-50" href={`/api/candidates/${candidateId}/resume`} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3.5" aria-hidden="true" /> Open in new tab</a>
                  </div>
                  <iframe title="Resume" src={`/api/candidates/${candidateId}/resume`} className="h-[70vh] w-full rounded-lg border border-zinc-200 bg-zinc-50" />
                </div>
              )}
              {resumeState === "text" && (
                <div className="space-y-2">
                  <Notice tone="amber">Only the profile/CV text was captured, not the original file.</Notice>
                  <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-sans text-sm text-zinc-800">{resumeText}</pre>
                </div>
              )}
              {resumeState === "none" && (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center">
                  <FileWarning className="size-8 text-zinc-400" aria-hidden="true" />
                  <h3 className="font-medium text-zinc-950">No resume saved for this candidate</h3>
                  <p className="max-w-sm text-sm text-zinc-600">Select this candidate on the job page and use <b>Get profile &amp; resume</b>. XS-Hunt asks you to approve it first because opening a Naukri profile or CV can use your credits.</p>
                </div>
              )}
            </div>
          )}

          {detail && tab === "notes" && (
            <div className="space-y-5">
              {detail.match.stage !== "rejected" && canEdit && (
                <RejectForm busy={busy} onReject={(reason) => void act({ action: "stage", to: "rejected", reason })} />
              )}
              <section>
                <h3 className="mb-1.5 text-sm font-medium text-zinc-950">Notes</h3>
                {canEdit && (
                  <div className="flex gap-2">
                    <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" aria-label="New note" />
                    <Button variant="primary" disabled={!note.trim()} loading={busy} onClick={() => void act({ action: "note", body: note }, () => setNote(""))}>Add</Button>
                  </div>
                )}
                <ul className="mt-2 space-y-1.5">
                  {detail.notes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800">
                      {n.body}
                      <span className="mt-0.5 block text-[11px] text-zinc-500">{new Date(n.createdAt).toLocaleString("en-IN")}</span>
                    </li>
                  ))}
                  {detail.notes.length === 0 && <li className="text-sm text-zinc-500">No notes yet.</li>}
                </ul>
              </section>
              <section>
                <h3 className="mb-1.5 text-sm font-medium text-zinc-950">Interviews</h3>
                {canEdit && (
                  <div className="flex gap-2">
                    <input className={inputClass} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Interview time" />
                    <Button variant="primary" disabled={!when} loading={busy} onClick={() => void act({ action: "interview", scheduledAt: new Date(when).toISOString() }, () => setWhen(""))}>Schedule</Button>
                  </div>
                )}
                <ul className="mt-2 space-y-1.5 text-sm">
                  {detail.interviews.map((i) => <li key={i.id} className="rounded-lg border border-zinc-200 px-3 py-2">{new Date(i.scheduledAt).toLocaleString("en-IN")} · {i.mode}{i.outcome ? ` · ${i.outcome}` : ""}</li>)}
                  {detail.interviews.length === 0 && <li className="text-zinc-500">None scheduled.</li>}
                </ul>
              </section>
              <section>
                <h3 className="mb-1.5 text-sm font-medium text-zinc-950">Reminders</h3>
                {canEdit && (
                  <div className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
                    <input className={inputClass} type="datetime-local" value={remind.at} onChange={(e) => setRemind({ ...remind, at: e.target.value })} aria-label="Reminder time" />
                    <input className={inputClass} value={remind.text} onChange={(e) => setRemind({ ...remind, text: e.target.value })} placeholder="What to do" aria-label="Reminder text" />
                    <Button variant="primary" disabled={!remind.at || !remind.text.trim()} loading={busy} onClick={() => void act({ action: "reminder", dueAt: new Date(remind.at).toISOString(), text: remind.text }, () => setRemind({ at: "", text: "" }))}>Set</Button>
                  </div>
                )}
                <ul className="mt-2 space-y-1.5 text-sm">
                  {detail.reminders.map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2">
                      <span className={r.doneAt ? "text-zinc-400 line-through" : ""}>{new Date(r.dueAt).toLocaleString("en-IN")}: {r.text}</span>
                      {!r.doneAt && canEdit && <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => void act({ action: "reminder_done", reminderId: r.id })}>Done</button>}
                    </li>
                  ))}
                  {detail.reminders.length === 0 && <li className="text-zinc-500">No reminders.</li>}
                </ul>
              </section>
            </div>
          )}

          {detail && tab === "activity" && (
            <ol className="space-y-2">
              {detail.events.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <FileText className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden="true" />
                  <div>
                    <p className="text-zinc-900">
                      {EVENT_TEXT[e.kind] ?? e.kind}
                      {e.kind === "stage" && `: ${STAGE_LABEL[e.fromStage as keyof typeof STAGE_LABEL] ?? e.fromStage} → ${STAGE_LABEL[e.toStage as keyof typeof STAGE_LABEL] ?? e.toStage}`}
                      {typeof e.data?.reason === "string" && <span className="text-zinc-600"> ({e.data.reason})</span>}
                    </p>
                    <p className="text-[11px] tabular-nums text-zinc-500">{new Date(e.createdAt).toLocaleString("en-IN")}</p>
                  </div>
                </li>
              ))}
              {detail.events.length === 0 && <li className="text-sm text-zinc-500">No activity yet.</li>}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}

export function RejectForm({ busy, onReject }: { busy: boolean; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <section className="rounded-lg border border-rose-200 bg-rose-50 p-3">
      <h3 className="text-sm font-medium text-rose-900">Reject candidate</h3>
      <div className="mt-1.5 flex gap-2">
        <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, kept in the history)" aria-label="Rejection reason" />
        <Button variant="danger" disabled={reason.trim().length < 3} loading={busy} onClick={() => onReject(reason.trim())}>Reject</Button>
      </div>
    </section>
  );
}
