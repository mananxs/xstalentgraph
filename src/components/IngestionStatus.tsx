import { Loader2, RotateCcw, Search, Sparkles } from "lucide-react";
import { useSourceName } from "@/hooks/useSourceName";
import { SourceToggle } from "./SourceToggle";
import type { BatchDto } from "@/lib/types";

interface IngestionStatusProps {
  batch: BatchDto | null;
  isActive: boolean;
  isStarting: boolean;
  /** How many candidates on screen are in the "failed" state. */
  failedMatchCount: number;
  /** Candidates that only have an offline Quick score (re-scored with AI on the next re-score run). */
  quickScoreCount?: number;
  onStart: () => void;
  /** Score the failed / Quick-scored candidates again, without searching GitHub. */
  onRetryFailed: () => void;
}

/** Shortens the raw error text from the server so the banner stays readable. */
function friendlyError(error: string | null): string {
  if (!error) return "unknown error.";
  if (/github token|GitHub returned no profiles|Bad credentials|401/i.test(error)) return error.length > 180 ? `${error.slice(0, 180)}…` : error;
  if (/503|UNAVAILABLE|high demand/i.test(error)) return "Gemini is overloaded right now. Wait a minute and press Retry.";
  if (/429|quota|rate/i.test(error)) return "Gemini quota reached. Wait a minute and press Retry.";
  if (/404|no longer available|not found/i.test(error)) return "the Gemini model is not available. Check LLM_MODEL in .env.";
  return error.length > 220 ? `${error.slice(0, 220)}…` : error;
}

/** Turns the batch counters into one sentence a recruiter understands. */
function describeProgress(batch: BatchDto, sourceName: string): string {
  if (batch.status === "queued") {
    return "Queued. If this stays here, start the worker with: npm run worker";
  }
  if (batch.profilesFound === 0 && batch.evaluationTotal === 0) return `Searching ${sourceName} for candidates…`;

  const done = batch.evaluatedCount + batch.failedCount;
  return `Found ${batch.profilesFound} so far, scored ${done} of ${batch.evaluationTotal}`;
}

/** The "Find candidates" button plus the progress of the latest run. */
export function IngestionStatus({ batch, isActive, isStarting, failedMatchCount, quickScoreCount = 0, onStart, onRetryFailed }: IngestionStatusProps) {
  const source = useSourceName();
  const redoCount = failedMatchCount + quickScoreCount;
  const done = batch ? batch.evaluatedCount + batch.failedCount : 0;
  const percent = batch && batch.evaluationTotal > 0 ? Math.round((done / batch.evaluationTotal) * 100) : 0;

  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <SourceToggle disabled={isActive || isStarting} />
      <button
        type="button"
        onClick={onStart}
        disabled={isActive || isStarting}
        className="flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isActive || isStarting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
        {isActive ? "Run in progress" : "Find candidates"}
      </button>

      {!isActive && redoCount > 0 && (
        <button
          type="button"
          onClick={onRetryFailed}
          disabled={isStarting}
          title="Scores these candidates again with the AI, without searching GitHub"
          className="flex h-10 items-center gap-2 rounded-xl border border-zinc-300 px-4 text-sm text-zinc-800 transition-colors hover:border-zinc-300 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {quickScoreCount > 0 ? <Sparkles className="size-4" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
          {quickScoreCount > 0 ? `Re-score ${redoCount} with AI` : `Retry ${failedMatchCount} failed`}
        </button>
      )}

      {batch && (
        <div className="min-w-0 text-sm" aria-live="polite">
          {isActive && (
            <>
              <p className="text-zinc-700">{describeProgress(batch, source.name)}</p>
              {batch.evaluationTotal > 0 && (
                <div
                  role="progressbar"
                  aria-label="Scoring progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  className="mt-1.5 h-1.5 w-56 overflow-hidden rounded-full bg-zinc-100"
                >
                  <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
                </div>
              )}
            </>
          )}
          {batch.status === "completed" && (
            <p className="max-w-md text-zinc-600">
              Last run: scored {batch.evaluatedCount}
              {batch.failedCount > 0 ? `, ${batch.failedCount} could not be saved` : ""}
              {batch.error ? <span className="block text-xs text-amber-800">{batch.error.length > 240 ? `${batch.error.slice(0, 240)}…` : batch.error}</span> : null}
            </p>
          )}
          {batch.status === "failed" && (
            <p className="max-w-md text-tier-low">
              Last run stopped: {friendlyError(batch.error)} Candidates already found stay in the list below.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
