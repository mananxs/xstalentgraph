"use client";

import { motion } from "framer-motion";
import { Bookmark, BookmarkCheck, Briefcase, ChevronDown, Clock, ExternalLink, FileText, GitCompareArrows, MapPin, StickyNote, UserRound, Wallet, XCircle } from "lucide-react";
import { useState } from "react";
import { SOURCE_LABEL, STAGES, STAGE_LABEL, type CandidateRow } from "@/lib/hunt";

const LINK_ORDER = ["linkedin", "naukri", "github", "cutshort"];
import { ScoreRing } from "../ScoreRing";
import { WhyMatches } from "./WhyMatches";
import { Avatar, Badge, Button, SourceBadge, TierBadge } from "./ui";

interface Props {
  row: CandidateRow;
  rank?: number | null;
  selected: boolean;
  canEdit: boolean;
  onSelect: (id: string, on: boolean) => void;
  onShortlist: (row: CandidateRow) => void;
  onStage: (row: CandidateRow, stage: string) => void;
  onReject: (row: CandidateRow) => void;
  onOpen: (row: CandidateRow, tab?: "overview" | "notes" | "resume") => void;
  onChanged: () => void;
}

/** One candidate of a job: who, from where, how well they match and why, plus every recruiter action. */
export function CandidateCard({ row, rank, selected, canEdit, onSelect, onShortlist, onStage, onReject, onOpen, onChanged }: Props) {
  const [why, setWhy] = useState(false);
  const shortlisted = row.shortlisted;
  const name = row.name ?? "Unnamed candidate";
  const links = [...(row.links ?? [])].sort((a, b) => LINK_ORDER.indexOf(a.source) - LINK_ORDER.indexOf(b.source));

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      aria-label={`${name}, ${row.tierLabel ?? "not evaluated"}${row.score !== null ? `, score ${row.score}` : ""}`}
      className={`flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${selected ? "border-accent ring-1 ring-accent/30" : "border-zinc-200"}`}
    >
      <header className="flex items-start gap-3">
        <label className="mt-1 flex cursor-pointer items-center" title="Select for compare or resume request">
          <input type="checkbox" checked={selected} onChange={(e) => onSelect(row.matchId, e.target.checked)} className="size-4 accent-[#4f46e5]" aria-label={`Select ${name}`} />
        </label>
        <Avatar name={name} src={row.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {rank ? <span className="text-xs tabular-nums text-zinc-400">#{rank}</span> : null}
            <h3 className="truncate text-[15px] font-semibold text-zinc-950">{name}</h3>
            {row.sources.map((s) => (
              <SourceBadge key={s} source={s} />
            ))}
          </div>
          <p className="truncate text-sm text-zinc-700">{row.headline ?? "No designation shown"}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums text-zinc-500">
            {row.experienceYears !== null && (
              <span className="inline-flex items-center gap-1">
                <Briefcase className="size-3" aria-hidden="true" /> {row.experienceYears} yrs
              </span>
            )}
            {row.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" aria-hidden="true" /> {row.location}
              </span>
            )}
            {row.ctc && (
              <span className="inline-flex items-center gap-1">
                <Wallet className="size-3" aria-hidden="true" /> {row.ctc}
              </span>
            )}
            {row.noticePeriod && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" /> {row.noticePeriod}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          {row.score !== null ? <ScoreRing score={row.score} size={52} /> : <span className="flex size-[52px] items-center justify-center rounded-full border border-dashed border-zinc-300 text-[10px] text-zinc-400">n/a</span>}
          <TierBadge tier={row.tier} />
          {row.overridden && (
            <Badge tone="indigo" title={`AI score ${row.aiScore ?? "n/a"}. Override: ${row.overrideReason ?? ""}`}>
              Overridden
            </Badge>
          )}
        </div>
      </header>

      {(row.strengths.length > 0 || row.concerns.length > 0 || row.missingInfo.length > 0) && (
        <div className="grid gap-1.5 text-xs sm:grid-cols-2">
          {row.strengths.slice(0, 2).map((s) => (
            <p key={s} className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">
              + {s}
            </p>
          ))}
          {row.concerns.slice(0, 2).map((s) => (
            <p key={s} className="rounded-md bg-rose-50 px-2 py-1 text-rose-800">
              − {s}
            </p>
          ))}
          {row.missingInfo.length > 0 && <p className="rounded-md bg-amber-50 px-2 py-1 text-amber-800 sm:col-span-2">Not shown: {row.missingInfo.join(", ")}. This is missing information, not a fail.</p>}
        </div>
      )}

      <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} className="flex items-center gap-1 self-start text-xs font-medium text-accent hover:underline">
        <ChevronDown className={`size-3.5 transition-transform ${why ? "rotate-180" : ""}`} aria-hidden="true" /> Why this candidate matches
      </button>
      {why && <WhyMatches matchId={row.matchId} canEdit={canEdit} onChanged={onChanged} />}

      <footer className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-3">
        <Button size="sm" variant={shortlisted ? "primary" : "secondary"} disabled={!canEdit} onClick={() => onShortlist(row)} aria-pressed={shortlisted}>
          {shortlisted ? <BookmarkCheck className="size-3.5" aria-hidden="true" /> : <Bookmark className="size-3.5" aria-hidden="true" />}
          {shortlisted ? "Shortlisted" : "Shortlist"}
        </Button>
        <label className="sr-only" htmlFor={`stage-${row.matchId}`}>
          Move {name} to stage
        </label>
        <select
          id={`stage-${row.matchId}`}
          value={row.stage}
          disabled={!canEdit}
          onChange={(e) => (e.target.value === "rejected" ? onReject(row) : onStage(row, e.target.value))}
          className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-800 disabled:opacity-50"
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        {links.length > 0 ? (
          <>
            {/* View Profile opens the person's real profile (LinkedIn first) in a new tab; Details opens the full evaluation here. */}
            {links.map((l, i) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" title={l.url} className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${i === 0 ? "border-transparent bg-accent text-white hover:bg-accent-strong" : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"}`}>
                <ExternalLink className="size-3.5" aria-hidden="true" /> {i === 0 ? "View Profile" : SOURCE_LABEL[l.source as keyof typeof SOURCE_LABEL] ?? l.source}
                {i === 0 && <span className="font-normal opacity-80">· {SOURCE_LABEL[l.source as keyof typeof SOURCE_LABEL] ?? l.source}</span>}
              </a>
            ))}
            <Button size="sm" onClick={() => onOpen(row, "overview")}>
              <UserRound className="size-3.5" aria-hidden="true" /> Details
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => onOpen(row, "overview")} title="No profile link was captured for this candidate yet">
            <UserRound className="size-3.5" aria-hidden="true" /> View Profile
          </Button>
        )}
        <Button size="sm" onClick={() => onOpen(row, "resume")} title={row.hasResume ? "Open the saved resume" : "No resume saved yet. Request it from the toolbar after selecting this candidate."}>
          <FileText className="size-3.5" aria-hidden="true" /> {row.hasResume ? "View Resume" : "Resume"}
        </Button>
        <Button size="sm" variant={selected ? "primary" : "secondary"} onClick={() => onSelect(row.matchId, !selected)} title="Add to comparison (pick 2 to 5)">
          <GitCompareArrows className="size-3.5" aria-hidden="true" /> Compare
        </Button>
        <Button size="sm" disabled={!canEdit} onClick={() => onOpen(row, "notes")}>
          <StickyNote className="size-3.5" aria-hidden="true" /> Add Note
        </Button>
        {row.stage !== "rejected" && (
          <Button size="sm" variant="danger" disabled={!canEdit} onClick={() => onReject(row)}>
            <XCircle className="size-3.5" aria-hidden="true" /> Reject
          </Button>
        )}
      </footer>
    </motion.article>
  );
}
