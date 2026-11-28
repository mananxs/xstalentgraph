"use client";

import { AnimatePresence } from "framer-motion";
import { Bookmark, BookmarkPlus, Gauge, Sparkles, Trophy, Users, Zap } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useIngestion } from "@/hooks/useIngestion";
import { useJobs } from "@/hooks/useJobs";
import { useMatches } from "@/hooks/useMatches";
import { api, toMessage } from "@/lib/api";
import { buildRankMap, passesScoreFilter, topMatches, TOP_N } from "@/lib/matches";
import type { JobDetailDto, MatchDto } from "@/lib/types";
import { useSourceName } from "@/hooks/useSourceName";
import { GitHubLogo, LinkedInLogo } from "./BrandLogos";
import { CandidateMatchCard } from "./CandidateMatchCard";
import { CardSkeleton } from "./CardSkeleton";
import { EmptyState } from "./EmptyState";
import { ErrorBanner } from "./ErrorBanner";
import { IngestionStatus } from "./IngestionStatus";
import { ScoreFilter } from "./ScoreFilter";
import { SearchBar } from "./SearchBar";
import { SourcingDialog } from "./SourcingDialog";
import { Tabs, type TabId } from "./Tabs";

interface DashboardProps {
  /** Job to open first (from ?job=...). Falls back to the first job. */
  initialJobId: string | null;
  initialTab: TabId;
}

const SKELETON_COUNT = 6;

/** True when the search text appears in the name, login, bio, location or any skill. */
function matchesSearch(match: MatchDto, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  const { candidate } = match;
  const haystack = [candidate.name, candidate.login, candidate.bio, candidate.location, ...match.matchedSkills, ...match.missingSkills]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

/** The main screen: pick a job, find candidates, then browse the top 10, filter and shortlist. */
export function Dashboard({ initialJobId, initialTab }: DashboardProps) {
  const jobsState = useJobs();
  const source = useSourceName();
  const [pickedJobId, setPickedJobId] = useState<string | null>(initialJobId);
  const [tab, setTab] = useState<TabId>(initialTab);
  const [minScore, setMinScore] = useState(0);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Use the picked job if it exists, otherwise the first job.
  const jobs = jobsState.jobs;
  const selectedJob = jobs.find((job) => job.id === pickedJobId) ?? jobs[0] ?? null;
  const jobId = selectedJob?.id ?? null;

  const matchesState = useMatches(jobId);
  const ingestion = useIngestion(jobId, () => void matchesState.refresh({ silent: true }));

  const all = matchesState.matches;
  const scored = all.filter((match) => match.status === "completed");
  const shortlistedCount = all.filter((match) => match.shortlisted).length;
  const failedCount = all.filter((match) => match.status === "failed").length;
  const quickCount = scored.filter((match) => match.scoredBy === "quick").length;
  const top = useMemo(() => topMatches(all, TOP_N), [all]);
  const topScored = top.filter((match) => match.score !== null);
  const topAverage = topScored.length ? Math.round(topScored.reduce((sum, match) => sum + (match.score ?? 0), 0) / topScored.length) : null;

  // Ranks come from ALL scored candidates, so they stay the same while filtering or searching.
  const ranks = useMemo(() => buildRankMap(all), [all]);

  const visibleMatches = useMemo(() => {
    const filtered = all.filter((match) => passesScoreFilter(match, minScore)).filter((match) => matchesSearch(match, search));
    // Sourced = only the best 10. Shortlisted = everyone shortlisted.
    return tab === "shortlisted" ? topMatches(filtered.filter((match) => match.shortlisted), filtered.length) : topMatches(filtered, TOP_N);
  }, [all, tab, minScore, search]);

  const hasActiveFilters = minScore > 0 || search.trim() !== "";
  const errorMessage = actionError ?? jobsState.error ?? matchesState.error ?? ingestion.error;

  function resetFilters() {
    setMinScore(0);
    setSearch("");
  }

  function retryAll() {
    setActionError(null);
    void jobsState.reload();
    void matchesState.refresh();
  }

  /** A job was created from a pasted / uploaded JD: queue the run first, then switch to it (so its progress loads). */
  async function handleJobCreated(job: JobDetailDto, searchNow: boolean) {
    if (searchNow) {
      try {
        await api.startIngestion(job.id, { rescoreOnly: false });
      } catch (caught) {
        setActionError(toMessage(caught));
      }
    }
    await jobsState.reload();
    setPickedJobId(job.id);
    setTab("sourced");
    resetFilters();
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-zinc-600">
            {source.linkedin ? <LinkedInLogo size={14} /> : <GitHubLogo size={14} className="text-emerald-700" />} Pipeline · {source.name} sourcing
          </p>
          {jobs.length > 1 ? (
            <>
              <label htmlFor="job-select" className="sr-only">
                Job
              </label>
              <select
                id="job-select"
                value={jobId ?? ""}
                onChange={(event) => setPickedJobId(event.target.value)}
                className="mt-1 max-w-full rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-xl font-semibold focus:border-accent/60"
              >
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <h1 className="mt-1 truncate text-2xl font-semibold">
              {jobsState.status === "loading" ? "Loading…" : (selectedJob?.title ?? "No jobs yet")}
            </h1>
          )}
        </div>

        <IngestionStatus
          batch={ingestion.batch}
          isActive={ingestion.isActive}
          isStarting={ingestion.isStarting}
          failedMatchCount={failedCount}
          quickScoreCount={quickCount}
          onStart={() => setDialogOpen(true)}
          onRetryFailed={() => void ingestion.start({ rescoreOnly: true })}
          onControl={(a) => void ingestion.control(a)}
        />
      </header>

      {errorMessage && <ErrorBanner message={errorMessage} onRetry={retryAll} />}

      {selectedJob && (
        <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={<Users className="size-4" aria-hidden="true" />} label="Sourced" value={all.length} hint={`${scored.length} scored`} />
          <Stat icon={<Trophy className="size-4" aria-hidden="true" />} label="Showing" value={Math.min(TOP_N, all.length)} hint={`top ${TOP_N} by match score`} />
          <Stat icon={<Gauge className="size-4" aria-hidden="true" />} label="Top 10 average" value={topAverage ?? "–"} hint={topAverage === null ? "no scores yet" : "out of 100"} />
          <Stat icon={<Bookmark className="size-4" aria-hidden="true" />} label="Shortlisted" value={shortlistedCount} hint="across this job" />
        </section>
      )}

      {quickCount > 0 && !ingestion.isActive && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <Zap className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
          <span>
            {quickCount} {quickCount === 1 ? "candidate has" : "candidates have"} a <strong>Quick score</strong> (offline skill / language / location match)
            because the AI was unavailable. Press <strong>Re-score with AI</strong> when it is back to upgrade them.
          </span>
        </p>
      )}

      <section aria-label="Filters" className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full lg:max-w-md">
          <SearchBar value={search} onChange={setSearch} />
        </div>
        <ScoreFilter value={minScore} onChange={setMinScore} />
      </section>

      <Tabs
        active={tab}
        onChange={setTab}
        sourcedLabel={`Top ${TOP_N}`}
        sourcedCount={Math.min(TOP_N, all.length)}
        sourcedTotal={all.length}
        shortlistedCount={shortlistedCount}
      />

      <section aria-label="Candidates" aria-busy={matchesState.status === "loading"}>
        {renderCandidates()}
      </section>

      <SourcingDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        purpose="sourcing"
        jobId={jobId}
        onSearchCurrent={(options) => ingestion.start(options)}
        onJobUpdated={() => void jobsState.reload()}
        onJobCreated={handleJobCreated}
      />
    </div>
  );

  function renderCandidates() {
    const isLoading = jobsState.status === "loading" || (matchesState.status === "loading" && matchesState.matches.length === 0);

    if (isLoading) {
      return (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      );
    }

    if (jobsState.status === "ready" && !selectedJob) {
      return (
        <EmptyState
          icon={<Sparkles className="size-8" aria-hidden="true" />}
          title="Create your first job"
          description={`Paste a job description or upload it as PDF / DOC. XS-Hunt reads it, searches ${source.name} and ranks the 10 best candidates.`}
          actionLabel="Find candidates from a JD"
          onAction={() => setDialogOpen(true)}
        />
      );
    }

    if (visibleMatches.length > 0) {
      return (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {visibleMatches.map((match) => (
              <CandidateMatchCard
                key={match.matchId}
                match={match}
                rank={ranks.get(match.matchId) ?? null}
                onToggleShortlist={(id) => void matchesState.toggleShortlist(id)}
                onRevealContact={(id) => matchesState.revealContact(id)}
              />
            ))}
          </AnimatePresence>
        </div>
      );
    }

    // Nothing to show. Explain why and offer the next step.
    if (matchesState.matches.length > 0 && hasActiveFilters) {
      return (
        <EmptyState
          title="No candidates match your filters"
          description="Lower the minimum score or clear the search to see everyone again."
          actionLabel="Reset filters"
          onAction={resetFilters}
        />
      );
    }

    if (tab === "shortlisted") {
      return (
        <EmptyState
          icon={<BookmarkPlus className="size-8" aria-hidden="true" />}
          title="No shortlisted candidates yet"
          description="Open the Top 10 tab and press Shortlist on the people you want to follow up with."
          actionLabel="Go to Top 10"
          onAction={() => setTab("sourced")}
        />
      );
    }

    return (
      <EmptyState
        icon={<Users className="size-8" aria-hidden="true" />}
        title={ingestion.isActive ? `Searching ${source.name}` : "No candidates yet"}
        description={
          ingestion.isActive
            ? "Candidates appear here as soon as they are found, and their scores fill in and re-rank the list."
            : `Search ${source.name} with this job's settings, a pasted JD, or an uploaded JD file. The best 10 are shown here.`
        }
        actionLabel="Find candidates"
        onAction={() => setDialogOpen(true)}
        actionDisabled={ingestion.isActive || ingestion.isStarting}
      />
    );
  }
}

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: number | string; hint: string }) {
  return (
    <div className="card-surface rounded-2xl border border-zinc-200 px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs text-zinc-600">
        <span className="text-accent">{icon}</span>
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-950">{value}</p>
      <p className="text-xs text-zinc-500">{hint}</p>
    </div>
  );
}
