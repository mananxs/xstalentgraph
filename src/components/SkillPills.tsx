"use client";

import { Check, Minus } from "lucide-react";
import { useState } from "react";

interface SkillPillsProps {
  title: "Matched" | "Missing";
  skills: string[];
  /** matched = solid green pills, missing = dashed rose pills (shape carries the meaning, not only color). */
  variant: "matched" | "missing";
  /** How many pills to show before "+N more". Default 4. */
  maxVisible?: number;
}

const PILL_STYLES = {
  matched: "border border-solid border-tier-high/50 bg-tier-high/15 text-tier-high",
  missing: "border border-dashed border-tier-low/70 bg-transparent text-tier-low",
} as const;

/** One labelled group of skill pills with a "+N more" toggle. */
export function SkillPills({ title, skills, variant, maxVisible = 4 }: SkillPillsProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = variant === "matched" ? Check : Minus;

  const hiddenCount = Math.max(0, skills.length - maxVisible);
  const visibleSkills = expanded ? skills : skills.slice(0, maxVisible);

  return (
    <div>
      <p className="mb-1.5 text-xs text-zinc-600">{title}</p>
      {skills.length === 0 ? (
        <p className="text-xs text-zinc-500">{variant === "matched" ? "No matching skills found" : "Nothing missing"}</p>
      ) : (
        <ul className="flex flex-wrap items-center gap-1.5">
          {visibleSkills.map((skill) => (
            <li key={skill} className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${PILL_STYLES[variant]}`}>
              <Icon className="size-3" aria-hidden="true" />
              {skill}
            </li>
          ))}
          {hiddenCount > 0 && (
            <li>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
                className="rounded-full px-2 py-0.5 text-xs text-zinc-600 hover:text-zinc-800"
              >
                {expanded ? "Show less" : `+${hiddenCount} more`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
