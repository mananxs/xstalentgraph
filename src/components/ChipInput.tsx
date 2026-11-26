"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";

interface ChipInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: string;
  /** Optional quick-pick suggestions shown under the field. */
  suggestions?: string[];
}

/** Editable list of short values: type and press Enter or comma; click x to remove. */
export function ChipInput({ label, values, onChange, placeholder, hint, suggestions = [] }: ChipInputProps) {
  const id = useId();
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((part) => part.trim()).filter(Boolean);
    const next = [...values];
    for (const part of parts) if (!next.some((value) => value.toLowerCase() === part.toLowerCase())) next.push(part);
    onChange(next);
    setDraft("");
  };

  const unused = suggestions.filter((suggestion) => !values.some((value) => value.toLowerCase() === suggestion.toLowerCase())).slice(0, 8);

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-zinc-600">
        {label}
      </label>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 focus-within:border-accent/60">
        {values.map((value) => (
          <span key={value} className="flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-0.5 text-xs text-accent">
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="rounded-full hover:text-zinc-950"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(event) => {
            if (event.target.value.includes(",")) add(event.target.value);
            else setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (draft.trim()) add(draft);
            } else if (event.key === "Backspace" && !draft && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={values.length === 0 ? placeholder : ""}
          className="min-w-24 flex-1 bg-transparent px-1 text-sm text-zinc-950 outline-none placeholder:text-zinc-400"
        />
      </div>
      {unused.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {unused.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => add(suggestion)}
              className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 hover:border-accent/50 hover:text-accent"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}
