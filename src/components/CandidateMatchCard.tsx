"use client";

import { motion } from "framer-motion";
import { Bookmark, BookmarkCheck, Briefcase, Crown, ExternalLink, FileText, KeyRound, Loader2, Mail, MapPin, Phone, Sparkles, Timer, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toMessage } from "@/lib/api";
import type { MatchDto } from "@/lib/types";
import { ScorePlaceholder } from "./ScorePlaceholder";
import { ScoreRing } from "./ScoreRing";
import { SkillPills } from "./SkillPills";

interface CandidateMatchCardProps {
  match: MatchDto;
  /** 1 = best scored candidate. null while the candidate has no score yet. */
  rank: number | null;
  onToggleShortlist: (matchId: string) => void;
  /** Cutshort only: fetch name / email / phone (spends one Cutshort credit the first time). Rejects with a readable message. */
  onRevealContact?: (matchId: string) => Promise<void>;
}

/** "+919876543210" -> "+91 98765 43210". Anything else is shown as given. */
function formatPhone(phone: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return match ? `+91 ${match[1]} ${match[2]}` : phone;
}

const MEDALS = ["text-amber-600", "text-zinc-400", "text-orange-600"] as const;

/** One ranked candidate: who they are, how well they match, and what is matched or missing. */
export function CandidateMatchCard({ match, rank, onToggleShortlist, onRevealContact }: CandidateMatchCardProps) {
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const { candidate, score, status, matchedSkills, missingSkills, shortlisted, scoredBy } = match;
  const displayName = candidate.name ?? (candidate.source === "cutshort" ? "Cutshort candidate" : candidate.login);
  const medal = rank !== null && rank <= 3 ? MEDALS[rank - 1] : null;
  const { phoneNumbers, emails } = candidate.contact;
  const hasContact = phoneNumbers.length > 0 || emails.length > 0;
  const canReveal = candidate.source === "cutshort" && !hasContact && onRevealContact !== undefined;

  async function reveal() {
    if (!onRevealContact) return;
    setRevealing(true);
    setRevealError(null);
    try {
      await onRevealContact(match.matchId);
    } catch (caught) {
      setRevealError(toMessage(caught));
    } finally {
      setRevealing(false);
    }
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      aria-label={score === null ? `${displayName}, ${status === "pending" ? "scoring in progress" : "not scored"}` : `${displayName}, rank ${rank ?? "-"}, match score ${score}`}
      className={`card-surface flex flex-col gap-4 rounded-2xl border p-5 transition-shadow duration-300 ${
        shortlisted
          ? "border-accent ring-1 ring-accent/30"
          : "border-zinc-200"
      }`}
    >
      <header className="flex items-start gap-3">
        {candidate.avatarUrl ? (
          // Plain <img>: GitHub avatars are remote, and we do not need Next's image optimizer here.
          <img
            src={candidate.avatarUrl}
            alt=""
            width={48}
            height={48}
            loading="lazy"
            className="size-12 shrink-0 rounded-full bg-zinc-100"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-lg text-zinc-600"
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 font-medium text-zinc-950">
            {medal && <Crown className={`size-4 shrink-0 ${medal}`} aria-label={`Top ${rank}`} />}
            <span className="truncate">{displayName}</span>
          </h3>
          <p className="truncate text-sm text-zinc-600">{candidate.source === "github" ? `@${candidate.login}` : candidate.source === "naukri" ? (candidate.headline ?? "Naukri candidate") : (candidate.headline ?? (candidate.source === "cutshort" ? "Contact details are revealed on request" : `@${candidate.login}`))}</p>
          {candidate.experienceYears !== null && (
            <p className="mt-1 flex items-center gap-1 truncate text-xs text-zinc-500">
              <Briefcase className="size-3 shrink-0" aria-hidden="true" /> {candidate.experienceYears} {candidate.experienceYears === 1 ? "year" : "years"} experience
            </p>
          )}
          {candidate.source === "naukri" && (candidate.ctc || candidate.noticePeriod) && (
            <p className="mt-1 flex items-center gap-1 truncate text-xs tabular-nums text-zinc-500">
              <Timer className="size-3 shrink-0" aria-hidden="true" /> {[candidate.ctc, candidate.noticePeriod && `${candidate.noticePeriod} notice`].filter(Boolean).join(" · ")}
            </p>
          )}
          {candidate.location && (
            <p className="mt-1 flex items-center gap-1 truncate text-xs text-zinc-500">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              {candidate.location}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1">
          {score !== null ? <ScoreRing score={score} /> : <ScorePlaceholder status={status === "failed" ? "failed" : "pending"} />}
          {rank !== null && <span className="text-xs tabular-nums text-zinc-500">#{rank}</span>}
          {scoredBy === "quick" && (
            <span
              title="Offline Quick score: the AI was unavailable. Use Re-score with AI to upgrade it."
              className="flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
            >
              <Zap className="size-2.5" aria-hidden="true" /> Quick
            </span>
          )}
          {scoredBy === "xray" && (
            <span
              title="Weighted score: skills 40%, experience 30%, impact 15%, industry 15%. Calculated free from the LinkedIn search snippet; no AI is used."
              className="flex items-center gap-0.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700"
            >
              <Zap className="size-2.5" aria-hidden="true" /> Weighted
            </span>
          )}
          {scoredBy === "extension" && (
            <span title="Scored in the Naukri extension against this job" className="flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
              <Sparkles className="size-2.5" aria-hidden="true" /> Rubric score
            </span>
          )}
          {scoredBy === "ai" && (
            <span title={match.model ?? "AI"} className="flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
              <Sparkles className="size-2.5" aria-hidden="true" /> AI
            </span>
          )}
        </div>
      </header>

      <p className="line-clamp-2 min-h-10 text-sm text-zinc-700">
        {(candidate.source === "naukri" ? (candidate.note ?? candidate.bio) : candidate.bio) ?? <span className="text-zinc-500">No bio on this profile.</span>}
      </p>

      {status === "completed" && (
        <div className="flex flex-col gap-3">
          <SkillPills title="Matched" skills={matchedSkills} variant="matched" />
          <SkillPills title="Missing" skills={missingSkills} variant="missing" />
        </div>
      )}

      {status === "pending" && (
        <div aria-hidden="true" className="flex animate-pulse flex-col gap-2">
          <div className="h-3 w-24 rounded bg-zinc-100" />
          <div className="h-5 w-3/4 rounded-full bg-zinc-100" />
          <p className="text-xs text-zinc-500">Matching skills against the job…</p>
        </div>
      )}

      {status === "failed" && (
        <p className="text-sm text-zinc-600" title={match.error ?? undefined}>
          Could not be scored this time{match.error ? ` (${match.error.slice(0, 80)}${match.error.length > 80 ? "…" : ""})` : ""}. Use{" "}
          <span className="text-zinc-800">Retry</span> at the top to try again.
        </p>
      )}

      {(hasContact || canReveal) && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm">
          {phoneNumbers.map((phone) => (
            <a key={phone} href={`tel:${phone}`} className="flex items-center gap-2 text-zinc-800 hover:text-zinc-950">
              <Phone className="size-3.5 shrink-0 text-emerald-700" aria-hidden="true" /> {formatPhone(phone)}
            </a>
          ))}
          {emails.map((email) => (
            <a key={email} href={`mailto:${email}`} className="flex items-center gap-2 truncate text-zinc-800 hover:text-zinc-950">
              <Mail className="size-3.5 shrink-0 text-accent" aria-hidden="true" /> {email}
            </a>
          ))}
          {canReveal && (
            <>
              <button
                type="button"
                onClick={() => void reveal()}
                disabled={revealing}
                title="Fetches the name, email and phone from Cutshort. The first reveal of a candidate uses one Cutshort credit."
                className="flex items-center justify-center gap-2 rounded-lg border border-accent/40 px-3 py-1.5 text-accent transition-colors hover:bg-accent/10 disabled:opacity-60"
              >
                {revealing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
                Reveal contact · 1 credit
              </button>
              {revealError && <p className="text-xs text-tier-low">{revealError}</p>}
            </>
          )}
        </div>
      )}

      <footer className="mt-auto flex items-center justify-between pt-1">
        {candidate.source === "naukri" ? (
          <Link
            href={`/candidates/${candidate.id}`}
            className={`flex items-center gap-1.5 text-sm hover:underline ${candidate.hasResume ? "text-accent" : "text-zinc-500"}`}
            title={candidate.hasResume ? "Opens the resume stored in XS-Hunt" : "No resume was captured yet. Open to see how to add it."}
          >
            <FileText className="size-3.5" aria-hidden="true" />
            {candidate.hasResume ? "View resume" : "Resume missing"}
          </Link>
        ) : (
          <a
            href={candidate.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-zinc-700 hover:text-zinc-950"
          >
            {candidate.source === "linkedin" ? "LinkedIn profile" : candidate.source === "cutshort" ? "Cutshort" : "GitHub profile"}
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}

        <button
          type="button"
          aria-pressed={shortlisted}
          onClick={() => onToggleShortlist(match.matchId)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            shortlisted
              ? "border-accent/60 bg-accent/10 text-accent"
              : "border-zinc-200 text-zinc-700 hover:border-zinc-300 hover:text-zinc-950"
          }`}
        >
          {shortlisted ? <BookmarkCheck className="size-4" aria-hidden="true" /> : <Bookmark className="size-4" aria-hidden="true" />}
          {shortlisted ? "Shortlisted" : "Shortlist"}
        </button>
      </footer>
    </motion.article>
  );
}
