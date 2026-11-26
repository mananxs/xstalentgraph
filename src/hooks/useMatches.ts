"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, toMessage } from "@/lib/api";
import { sortMatches } from "@/lib/matches";
import type { MatchDto } from "@/lib/types";
import type { LoadStatus } from "./useJobs";

/** Loads scored candidates of one job and handles the shortlist toggle (with instant UI feedback). */
export function useMatches(jobId: string | null) {
  const [matches, setMatches] = useState<MatchDto[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  // Ignore answers that arrive after the user already switched to another job.
  const latestJobId = useRef<string | null>(jobId);

  /** `silent` refreshes in the background without showing skeletons (used while a run is in progress). */
  const refresh = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!jobId) return;
      if (!options.silent) setStatus("loading");

      try {
        const response = await api.listMatches(jobId);
        if (latestJobId.current !== jobId) return;
        // Sorting here means cards re-rank by themselves every time new scores arrive.
        setMatches(sortMatches(response.matches));
        setError(null);
        setStatus("ready");
      } catch (caught) {
        if (latestJobId.current !== jobId) return;
        // A background refresh that fails is not worth a red banner: keep showing what we have, try again next tick.
        if (options.silent) return;
        setError(toMessage(caught));
        setStatus("error");
      }
    },
    [jobId],
  );

  useEffect(() => {
    latestJobId.current = jobId;
    setMatches([]);
    void refresh();
  }, [jobId, refresh]);

  const toggleShortlist = useCallback(
    async (matchId: string) => {
      if (!jobId) return;
      const current = matches.find((match) => match.matchId === matchId);
      if (!current) return;

      const next = !current.shortlisted;
      const setFlag = (value: boolean) =>
        setMatches((items) => items.map((m) => (m.matchId === matchId ? { ...m, shortlisted: value } : m)));

      setFlag(next); // show the change immediately
      try {
        await api.setShortlisted(jobId, matchId, next);
      } catch (caught) {
        setFlag(current.shortlisted); // the server said no: put it back
        setError(toMessage(caught));
      }
    },
    [jobId, matches],
  );

  /** Reveals a Cutshort candidate's contact details, then reloads the list so the card shows them. Throws the server's message. */
  const revealContact = useCallback(
    async (matchId: string) => {
      if (!jobId) return;
      await api.revealContact(jobId, matchId);
      await refresh({ silent: true });
    },
    [jobId, refresh],
  );

  return { matches, status, error, refresh, toggleShortlist, revealContact };
}
