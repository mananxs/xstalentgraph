"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toMessage } from "@/lib/api";
import { hunt, type CandidateRow } from "@/lib/hunt";
import { Modal } from "../Modal";
import { Badge, Button, inputClass, Notice } from "./ui";
import { isDimension } from "./WhyMatches";

/* ───────────────────────── reject ───────────────────────── */
export function RejectDialog({ row, onClose, onConfirm }: { row: CandidateRow | null; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setReason(""); setError(null); }, [row?.matchId]);
  return (
    <Modal open={row !== null} onClose={onClose} title={`Reject ${row?.name ?? "candidate"}`} description="The reason is saved in the candidate's history." widthClass="max-w-md">
      <div className="space-y-3">
        <input className={inputClass} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. notice period too long" aria-label="Rejection reason" />
        {error && <Notice>{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={reason.trim().length < 3} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); onClose(); } catch (e) { setError(toMessage(e)); } finally { setBusy(false); } }}>Reject</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────── resume / profile retrieval (credit warning) ───────────────────────── */
export function RetrievalDialog({ open, jobId, rows, onClose, onDone }: { open: boolean; jobId: string; rows: CandidateRow[]; onClose: () => void; onDone: () => void }) {
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ queued: number; unavailable: Array<{ candidateId: string; reason: string }> } | null>(null);
  useEffect(() => { if (open) { setAck(false); setError(null); setResult(null); } }, [open]);
  const naukri = rows.filter((r) => r.sources.includes("naukri"));
  const other = rows.length - naukri.length;
  return (
    <Modal open={open} onClose={onClose} title="Get full profile and resume from Naukri" description="Only the candidates you selected. Nothing is opened automatically." widthClass="max-w-lg">
      {result ? (
        <div className="space-y-3">
          <Notice tone="green"><CheckCircle2 className="mr-1 inline size-4" aria-hidden="true" /> {result.queued} request{result.queued === 1 ? "" : "s"} sent to your extension. It opens one profile at a time with a pause in between. Progress shows on each candidate.</Notice>
          {result.unavailable.length > 0 && (
            <ul className="space-y-1 text-sm text-amber-900">
              {result.unavailable.map((u) => <li key={u.candidateId} className="rounded-md bg-amber-50 px-2 py-1">{rows.find((r) => r.candidateId === u.candidateId)?.name ?? "Candidate"}: {u.reason}</li>)}
            </ul>
          )}
          <div className="flex justify-end"><Button variant="primary" onClick={() => { onDone(); onClose(); }}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>Opening a Naukri profile or downloading a CV <b>may use your Resdex view / contact / download credits</b>. XS-Hunt cannot see or change your credit balance, and it will not get around any limit. If Naukri asks for a credit your account does not have, the request is marked unavailable.</p>
          </div>
          <p className="text-sm text-zinc-700"><b>{naukri.length}</b> Naukri candidate{naukri.length === 1 ? "" : "s"} selected{other > 0 ? ` (${other} from other sources are skipped: they have no Naukri profile)` : ""}:</p>
          <ul className="max-h-40 space-y-1 overflow-auto text-sm">
            {naukri.map((r) => <li key={r.matchId} className="flex items-center justify-between rounded-md bg-zinc-50 px-2 py-1"><span className="truncate">{r.name}</span>{r.fullProfile ? <Badge tone="green">Profile saved</Badge> : <Badge>Card only</Badge>}</li>)}
          </ul>
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input type="checkbox" className="mt-0.5 size-4 accent-[#4f46e5]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I understand this may use Naukri credits and I approve opening these {naukri.length} profile{naukri.length === 1 ? "" : "s"}.
          </label>
          {error && <Notice>{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!ack || naukri.length === 0} loading={busy} onClick={async () => { setBusy(true); setError(null); try { setResult(await hunt.retrieve(jobId, naukri.map((r) => r.candidateId))); } catch (e) { setError(toMessage(e)); } finally { setBusy(false); } }}>Approve and request</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────── compare 2 to 5 ───────────────────────── */
const ROWS: Array<{ key: string; label: string }> = [{ key: "skills", label: "Technical skills" }, { key: "experience", label: "Work experience" }, { key: "projects", label: "Project relevance" }, { key: "education", label: "Education" }, { key: "tools", label: "Tools & frameworks" }, { key: "keywords", label: "Keywords / ATS" }, { key: "domain", label: "Domain / industry" }, { key: "compensation", label: "Compensation (flag)" }, { key: "availability", label: "Notice period (flag)" }, { key: "location", label: "Location (flag)" }];

export function CompareDialog({ open, jobId, ids, onClose }: { open: boolean; jobId: string; ids: string[]; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof hunt.compare>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setData(null);
    setError(null);
    hunt.compare(jobId, ids).then(setData).catch((e: unknown) => setError(toMessage(e)));
  }, [open, jobId, ids]);
  const customKeys = data ? [...new Set(data.candidates.flatMap((c) => Object.keys(c.dimensions).filter((k) => k.startsWith("custom_"))))] : [];
  const cell = (c: NonNullable<typeof data>["candidates"][number], key: string) => {
    const d = c.dimensions[key];
    if (!isDimension(d)) return <span className="text-zinc-400">No evaluation</span>;
    if (d.status === "missing") return <span className="text-amber-700">Not shown</span>;
    if (d.status === "skipped") return <span className="text-zinc-400">Not scored</span>;
    return <span><b className={d.status === "mismatch" ? "text-rose-700" : "text-zinc-950"}>{d.score}</b> <span className="text-xs text-zinc-600">{d.note}</span></span>;
  };
  return (
    <Modal open={open} onClose={onClose} title="Compare candidates" description="Missing data is shown as missing, never guessed." widthClass="max-w-6xl">
      {error && <Notice>{error}</Notice>}
      {!data && !error && <p className="text-sm text-zinc-500">Loading…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr>
                <th className="w-40 border-b border-zinc-200 p-2" />
                {data.candidates.map((c) => (
                  <th key={c.matchId} className="border-b border-zinc-200 p-2 align-top font-medium">
                    <div className="text-zinc-950">{c.name}</div>
                    <div className="text-xs font-normal text-zinc-600">{c.headline}</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-accent">{c.score ?? "n/a"}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row label="Match tier" cells={data.candidates.map((c) => <span key={c.matchId}>{c.tierLabel ?? "Not evaluated"}</span>)} />
              <Row label="Experience (stated)" cells={data.candidates.map((c) => <span key={c.matchId}>{c.experienceYears !== null ? `${c.experienceYears} yrs` : <span className="text-amber-700">Not shown</span>}</span>)} />
              <Row label="CTC" cells={data.candidates.map((c) => <span key={c.matchId}>{c.ctc ?? <span className="text-amber-700">Not shown</span>}</span>)} />
              <Row label="Notice period" cells={data.candidates.map((c) => <span key={c.matchId}>{c.noticePeriod ?? <span className="text-amber-700">Not shown</span>}</span>)} />
              <Row label="Location" cells={data.candidates.map((c) => <span key={c.matchId}>{c.location ?? <span className="text-amber-700">Not shown</span>}</span>)} />
              <Row label="Skills" cells={data.candidates.map((c) => <span key={c.matchId} className="text-xs">{c.skills.length ? c.skills.slice(0, 10).join(", ") : <span className="text-amber-700">Not shown</span>}</span>)} />
              <Row label="Certifications" cells={data.candidates.map((c) => <span key={c.matchId} className="text-xs">{c.certifications?.join(", ") ?? <span className="text-amber-700">None found in the saved text</span>}</span>)} />
              {ROWS.map((r) => <Row key={r.key} label={`${r.label} (criterion)`} cells={data.candidates.map((c) => <span key={c.matchId}>{cell(c, r.key)}</span>)} />)}
              {customKeys.map((k) => <Row key={k} label={`Custom ${Number(k.slice(7)) + 1}`} cells={data.candidates.map((c) => <span key={c.matchId}>{cell(c, k)}</span>)} />)}
              <Row label="Missing information" cells={data.candidates.map((c) => <span key={c.matchId} className="text-xs text-amber-800">{c.missingInfo.join(", ") || "—"}</span>)} />
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
function Row({ label, cells }: { label: string; cells: React.ReactNode[] }) {
  return (
    <tr className="border-b border-zinc-100">
      <th scope="row" className="p-2 align-top text-xs font-medium text-zinc-600">{label}</th>
      {cells.map((c, i) => <td key={i} className="p-2 align-top">{c}</td>)}
    </tr>
  );
}
