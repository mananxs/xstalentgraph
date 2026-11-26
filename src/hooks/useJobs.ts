"use client";

import { useCallback, useEffect, useState } from "react";
import { api, toMessage } from "@/lib/api";
import type { JobSummary } from "@/lib/types";

export type LoadStatus = "loading" | "ready" | "error";

/** Loads the organization's jobs once, and lets the page reload them. */
export function useJobs() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await api.listJobs();
      setJobs(response.jobs);
      setStatus("ready");
    } catch (caught) {
      setError(toMessage(caught));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { jobs, status, error, reload };
}
