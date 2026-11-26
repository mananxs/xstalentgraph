"use client";

import { motion } from "framer-motion";

export type TabId = "sourced" | "shortlisted";

interface TabsProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  sourcedCount: number;
  /** Label of the first tab. Default "Sourced". */
  sourcedLabel?: string;
  /** Total sourced (shown as "10 of 30" when larger than sourcedCount). */
  sourcedTotal?: number;
  shortlistedCount: number;
}

/** Sourced / Shortlisted tabs with live counts. */
export function Tabs({ active, onChange, sourcedCount, sourcedLabel = "Sourced", sourcedTotal, shortlistedCount }: TabsProps) {
  const tabs: Array<{ id: TabId; label: string; count: string }> = [
    {
      id: "sourced",
      label: sourcedLabel,
      count: sourcedTotal !== undefined && sourcedTotal > sourcedCount ? `${sourcedCount} of ${sourcedTotal}` : String(sourcedCount),
    },
    { id: "shortlisted", label: "Shortlisted", count: String(shortlistedCount) },
  ];

  return (
    <div role="tablist" aria-label="Candidate lists" className="flex gap-1 border-b border-zinc-200">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
              selected ? "text-zinc-950" : "text-zinc-600 hover:text-zinc-800"
            }`}
          >
            {tab.label}
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs tabular-nums">{tab.count}</span>
            {selected && (
              <motion.span
                layoutId="tab-underline"
                className="absolute inset-x-0 -bottom-px h-0.5 bg-accent"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
