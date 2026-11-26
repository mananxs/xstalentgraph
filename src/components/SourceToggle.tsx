"use client";

import type { ReactNode } from "react";

import { useSourceName, type SourceId } from "@/hooks/useSourceName";
import { CutshortLogo, GitHubLogo, LinkedInLogo } from "./BrandLogos";

/**
 * Source switches shown next to every "search" action. GitHub is exclusive. LinkedIn and Cutshort can both be on:
 * the run then searches both and ranks everyone together. A source is disabled until its key is set in .env.
 */
export function SourceToggle({ disabled = false }: { disabled?: boolean }) {
  const source = useSourceName();

  const options: Array<{ id: SourceId; label: string; icon: ReactNode; enabled: boolean; hint: string }> = [
    { id: "github", label: "GitHub", icon: <GitHubLogo size={14} />, enabled: true, hint: "Search public GitHub developers (switches the others off)" },
    {
      id: "linkedin",
      label: "LinkedIn",
      icon: <LinkedInLogo size={14} />,
      enabled: source.available.linkedin,
      hint: source.available.linkedin ? "Find LinkedIn profiles with Google X-Ray search (Apify)" : "Set APIFY_API_TOKEN in .env to enable",
    },
    {
      id: "cutshort",
      label: "Cutshort",
      icon: <CutshortLogo size={14} />,
      enabled: source.available.cutshort,
      hint: source.available.cutshort
        ? "Search Cutshort's Indian tech talent. Contact details are unlocked only for the best matches (uses Cutshort credits)"
        : "Set CUTSHORT_API_KEY in .env to enable",
    },
  ];

  return (
    <div role="group" aria-label="Candidate sources" className="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1">
      {options.map((option) => {
        const selected = source.sources.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            title={option.hint}
            disabled={disabled || !option.enabled}
            onClick={() => source.toggle(option.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              selected ? "bg-accent/10 text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-800"
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
