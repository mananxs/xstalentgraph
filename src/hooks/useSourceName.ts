"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";

export type SourceId = "github" | "linkedin" | "cutshort";

export interface SourceInfo {
  /** "github", or "linkedin" when any external source (LinkedIn and/or Cutshort) is switched on. */
  id: "github" | "linkedin";
  /** Label for the next search: "GitHub", "LinkedIn", "Cutshort" or "LinkedIn + Cutshort". */
  name: string;
  /** true when the next search uses LinkedIn and/or Cutshort. */
  linkedin: boolean;
  /** The sources the next search will use (GitHub is always alone). */
  sources: SourceId[];
  /** false when APIFY_API_TOKEN and CUTSHORT_API_KEY are both missing. */
  linkedinAvailable: boolean;
  /** Per-source availability (a key is set in .env). */
  available: { linkedin: boolean; cutshort: boolean };
  /** Switches one source on or off. GitHub is exclusive; LinkedIn and Cutshort can be combined; at least one stays on. */
  toggle: (source: SourceId) => void;
}

const STORAGE_KEY = "talentgraph:sources";

/** Tiny shared store, so the toggle, the labels and the "start search" call always agree. */
let availability: { linkedin: boolean; cutshort: boolean } | null = null; // null = not known yet
let preference: SourceId[] | null = null;
const listeners = new Set<() => void>();
let loading = false;

function readStoredPreference(): SourceId[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter((value): value is SourceId => value === "github" || value === "linkedin" || value === "cutshort");
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** What the next search uses: the saved choice limited to what is configured; otherwise the best available default. */
function effectiveSources(): SourceId[] {
  const available = availability ?? { linkedin: false, cutshort: false };
  const wanted = preference ?? [];
  if (wanted.includes("github") && wanted.length === 1) return ["github"];
  const external = wanted.filter((source): source is "linkedin" | "cutshort" => source !== "github" && available[source]);
  if (external.length > 0) return external;
  // Nothing (valid) chosen yet: LinkedIn if configured, else Cutshort, else GitHub.
  return available.linkedin ? ["linkedin"] : available.cutshort ? ["cutshort"] : ["github"];
}

/** For non-React code (the "start search" call). undefined until the server has answered, so the server decides. */
export function getSelectedSources(): SourceId[] | undefined {
  return availability === null ? undefined : effectiveSources();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Snapshot is a string so React can compare it cheaply: "<sources>|<linkedin available>|<cutshort available>".
function getSnapshot(): string {
  return `${effectiveSources().join(",")}|${availability?.linkedin === true}|${availability?.cutshort === true}`;
}

function labelOf(sources: SourceId[]): string {
  if (sources.includes("github")) return "GitHub";
  const parts = [sources.includes("linkedin") ? "LinkedIn" : null, sources.includes("cutshort") ? "Cutshort" : null].filter(Boolean);
  return parts.join(" + ") || "GitHub";
}

/** Which candidate sources "Find candidates" uses, with `toggle` for the GitHub / LinkedIn / Cutshort switches. */
export function useSourceName(): SourceInfo {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "github|false|false");

  useEffect(() => {
    if (preference === null) {
      preference = readStoredPreference();
      emit();
    }
    if (availability !== null || loading) return;
    loading = true;
    api
      .systemStatus()
      .then((status) => {
        availability = { linkedin: Boolean(status.sourcing.linkedin), cutshort: Boolean(status.sourcing.cutshort) };
        emit();
      })
      .catch(() => {
        /* keep GitHub as the default label */
      })
      .finally(() => {
        loading = false;
      });
  }, []);

  const toggle = useCallback((source: SourceId) => {
    const current = effectiveSources();
    let next: SourceId[];
    if (source === "github") {
      next = ["github"];
    } else {
      const external = current.filter((value): value is "linkedin" | "cutshort" => value !== "github");
      next = external.includes(source) ? external.filter((value) => value !== source) : [...external, source];
      if (next.length === 0) return; // at least one source stays on
    }
    preference = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode: the choice just will not survive a reload */
    }
    emit();
  }, []);

  const [list, linkedinOn, cutshortOn] = snapshot.split("|") as [string, string, string];
  const sources = list.split(",") as SourceId[];
  const external = !sources.includes("github");
  return {
    id: external ? "linkedin" : "github",
    name: labelOf(sources),
    linkedin: external,
    sources,
    linkedinAvailable: linkedinOn === "true" || cutshortOn === "true",
    available: { linkedin: linkedinOn === "true", cutshort: cutshortOn === "true" },
    toggle,
  };
}
