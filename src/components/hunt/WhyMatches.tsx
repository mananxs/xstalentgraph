"use client";

import { useCallback, useEffect, useState } from "react";
import { hunt, type DimensionResult, type MatchDetail } from "@/lib/hunt";
import { toMessage } from "@/lib/api";
import { Badge, Button, inputClass, Notice, ProgressBar, Skeleton } from "./ui";

const LABEL: Record<string, string> = { skills: "Technical skills match", experience: "Relevant work experience", projects: "Project relevance", education: "Qualifications / education", tools: "Tools, technologies & frameworks", keywords: "Keywords & ATS", domain: "Domain / industry", compensation: "Compensation (flag)", availability: "Notice period (flag)", location: "Location (flag)", career: "Career background (old)" };
const STATUS_TONE = { confirmed: "green", mismatch: "red", missing: "amber", skipped: "neutral" } as const;
const STATUS_TEXT = { confirmed: "Confirmed", mismatch: "Mismatch", missing: "Missing information", skipped: "Not scored (rubric sets no requirement)" } as const;

export const isDimension = (v: unknown): v is DimensionResult => typeof v === "object" && v !== null && "status" in v && "weight" in v;

/** Per-criterion scores with the evidence behind each, what is missing vs what truly mismatches, and the recruiter override. */
export function WhyMatches({ matchId, canEdit, onChanged }: { matchId: string; canEdit: boolean; onChanged: () => void }) {
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState("");
  const [tier, setTier] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    hunt.match(matchId).then(setDetail).catch((e: unknown) => setError(toMessage(e)));
  }, [matchId]);
  useEffect(load, [load]);

  async function override() {
    setBusy(true);
    setError(null);
    try {
      await hunt.act(matchId, { action: "override", reason, ...(score ? { score: Number(score) } : {}), ...(tier ? { tier } : {}) });
      setReason("");
      setScore("");
      load();
      onChanged();
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    try {
      await hunt.act(matchId, { action: "clear_override" });
      load();
      onChanged();
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) return <Notice>{error}</Notice>;
  if (!detail) return <Skeleton className="h-32" />;
  const ev = detail.evaluation;
  if (!ev) return <Notice tone="amber">This candidate has not been evaluated under the job&apos;s rubric yet. Start AI analysis in Find Candidates, or re-evaluate from the Rubric tab.</Notice>;
  const dims = Object.entries(ev.dimensions).filter((entry): entry is [string, DimensionResult] => isDimension(entry[1]));

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-xs text-zinc-600">
        Rubric v{ev.rubricVersion} · {Math.round(ev.evidenceCoverage * 100)}% of the rubric is backed by real data · evaluated {new Date(ev.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
      </p>
      <ul className="space-y-2">
        {dims.map(([key, d]) => (
          <li key={key} className="rounded-lg border border-zinc-200 bg-white p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-950">{LABEL[key] ?? (key.startsWith("custom_") ? `Custom criterion ${Number(key.slice(7)) + 1}` : key)}</span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-zinc-500">weight {d.weight}</span>
                <Badge tone={STATUS_TONE[d.status]}>{STATUS_TEXT[d.status]}</Badge>
                {d.score !== null && <span className="text-sm font-semibold tabular-nums text-zinc-950">{d.score}</span>}
              </span>
            </div>
            {d.score !== null && <div className="mt-1.5"><ProgressBar value={d.score} max={100} tone={d.score >= 75 ? "green" : d.score >= 55 ? "indigo" : "amber"} label={`${key} score`} /></div>}
            <p className="mt-1.5 text-xs text-zinc-700">{d.note}</p>
            {d.evidence.length > 0 && <p className="mt-1 text-[11px] text-zinc-500">Evidence: {d.evidence.join(" · ")}</p>}
          </li>
        ))}
      </ul>
      {detail.history.length > 1 && (
        <details className="text-xs text-zinc-600">
          <summary className="cursor-pointer font-medium text-zinc-700">Evaluation history ({detail.history.length})</summary>
          <ul className="mt-1 space-y-0.5 tabular-nums">
            {detail.history.map((h) => (
              <li key={h.id}>
                {new Date(h.createdAt).toLocaleDateString("en-IN")}: {h.total} ({h.tier}), rubric v{h.rubricVersion}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white p-2.5">
        <p className="text-xs font-medium text-zinc-800">Recruiter override</p>
        {detail.match.overrideReason ? (
          <p className="mt-1 text-xs text-zinc-700">
            Set to <b>{detail.match.overrideScore ?? "—"}</b> {detail.match.overrideTier ? `(${detail.match.overrideTier})` : ""} because: {detail.match.overrideReason}. The AI score ({detail.match.aiScore ?? "n/a"}) is kept.{" "}
            {canEdit && (
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => void clear()} disabled={busy}>
                Remove override
              </button>
            )}
          </p>
        ) : canEdit ? (
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-[80px_130px_1fr_auto]">
            <input className={inputClass} inputMode="numeric" placeholder="Score" value={score} onChange={(e) => setScore(e.target.value.replace(/\D/g, "").slice(0, 3))} aria-label="Override score" />
            <select className={inputClass} value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Override tier">
              <option value="">Tier (optional)</option>
              <option value="strong">Strong</option>
              <option value="potential">Potential</option>
              <option value="weak">Weak</option>
            </select>
            <input className={inputClass} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Override reason" />
            <Button size="sm" variant="primary" disabled={reason.trim().length < 3 || (!score && !tier)} loading={busy} onClick={() => void override()}>
              Override
            </Button>
          </div>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">No override.</p>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
