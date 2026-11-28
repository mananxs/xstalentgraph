"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, toMessage } from "@/lib/api";
import type { BatchDto } from "@/lib/types";
import { getSelectedSources } from "./useSourceName";

const POLL_INTERVAL_MS = 2000;
/** Show the "lost connection" banner only after this many failed polls in a row (one blip is normal). */
const MAX_POLL_FAILURES = 3;

export interface StartOptions {
  /** true = skip the GitHub search and only score candidates that are unscored or failed. */
  rescoreOnly?: boolean;
  /** How many profiles this run should find (server cap 200). Omitted = the server default. */
  maxProfiles?: number;
}

/**
 * Starts a background run for a job and follows its progress.
 * While the run is queued or running, the batch is polled and `onProgress` is called each time,
 * so the dashboard can show newly found and newly scored candidates as they appear.
 */
export function useIngestion(jobId: string | null, onProgress: () => void) {
  const [batch, setBatch] = useState<BatchDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const pollFailures = useRef(0);

  // Keep the latest callback without restarting the polling timer.
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  // Load the latest run when the job changes (so progress survives a page reload).
  useEffect(() => {
    setBatch(null);
    setError(null);
    if (!jobId) return;

    let cancelled = false;
    api
      .getLatestBatch(jobId)
      .then((response) => {
        if (!cancelled) setBatch(response.batch);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const batchId = batch?.id ?? null;
  const isActive = batch?.status === "queued" || batch?.status === "running";

  // Poll while the run is active.
  useEffect(() => {
    if (!jobId || !batchId || !isActive) return;

    const timer = setInterval(() => {
      api
        .getBatch(jobId, batchId)
        .then((response) => {
          pollFailures.current = 0;
          setError(null);
          setBatch(response.batch);
          onProgressRef.current();
        })
        .catch((caught: unknown) => {
          // The dev server may be restarting for a moment. Keep trying, and only complain if it keeps failing.
          pollFailures.current += 1;
          if (pollFailures.current >= MAX_POLL_FAILURES) setError(toMessage(caught));
        });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [jobId, batchId, isActive]);

  const start = useCallback(
    async (options: StartOptions & { jobId?: string } = {}) => {
      const targetJobId = options.jobId ?? jobId;
      if (!targetJobId) return;

      setIsStarting(true);
      setError(null);
      pollFailures.current = 0;

      try {
        // The server decides how many profiles to fetch (SOURCING_MAX_PROFILES); the dashboard shows the best 10.
        const { batchId: newBatchId } = await api.startIngestion(targetJobId, {
          rescoreOnly: options.rescoreOnly ?? false,
          sources: options.rescoreOnly ? undefined : getSelectedSources(),
          ...(options.maxProfiles && !options.rescoreOnly ? { maxProfiles: options.maxProfiles } : {}),
        });
        const response = await api.getBatch(targetJobId, newBatchId);
        if (targetJobId === jobId) setBatch(response.batch);
      } catch (caught) {
        setError(toMessage(caught));
      } finally {
        setIsStarting(false);
      }
    },
    [jobId],
  );

  /** Pause, resume or stop the current run (the play / pause / stop buttons). The batch is refreshed from the server's answer. */
  const control = useCallback(
    async (action: "pause" | "resume" | "stop") => {
      if (!jobId || !batchId) return;
      try {
        const response = await api.controlBatch(jobId, batchId, action);
        setError(null);
        setBatch(response.batch);
        onProgressRef.current();
      } catch (caught) {
        setError(toMessage(caught));
      }
    },
    [jobId, batchId],
  );

  return { batch, error, isActive, isStarting, start, control };
}
