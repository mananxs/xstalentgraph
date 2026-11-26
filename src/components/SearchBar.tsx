"use client";

import { Search } from "lucide-react";
import { useEffect, useRef } from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

/** Search box. Press "/" anywhere to focus it, Escape to leave it. Glows while focused. */
export function SearchBar({ value, onChange }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;

      // Do not steal the slash while the person is typing somewhere.
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isTyping) return;

      event.preventDefault();
      inputRef.current?.focus();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <label className="flex h-10 w-full items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100 px-3 text-zinc-600 transition-shadow focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20">
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">Search candidates</span>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
        }}
        placeholder="Search by name, skill or location"
        className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-500 focus-visible:outline-none"
      />
      <kbd className="hidden rounded border border-zinc-200 px-1.5 py-0.5 text-xs text-zinc-500 sm:block" aria-hidden="true">
        /
      </kbd>
    </label>
  );
}
