"use client";

import { Flame, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** The three themes, in the order the toggle cycles: dark -> light -> warm -> dark. */
export const THEMES = ["dark", "light", "warm"] as const;
export type Theme = (typeof THEMES)[number];
const KEY = "xs-theme";
const ICON = { dark: Moon, light: Sun, warm: Flame } as const;
const LABEL = { dark: "Dark", light: "Light", warm: "Warm" } as const;

export const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]!;

function read(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light" || saved === "warm") return saved;
  } catch {
    /* storage blocked: fall through to the default */
  }
  return "light";
}

export function applyTheme(t: Theme, animate = true) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-fade");
    window.setTimeout(() => root.classList.remove("theme-fade"), 450);
  }
  root.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* not important */
  }
}

/** One button that cycles dark -> light -> warm. Works on every page (app, login, landing). */
export function ThemeToggle({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(read()), []);
  const shown = theme ?? "light";
  const Icon = ICON[shown];
  const next = nextTheme(shown);
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      aria-label={`Theme: ${LABEL[shown]}. Switch to ${LABEL[next]}.`}
      title={`Theme: ${LABEL[shown]} (click for ${LABEL[next]})`}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950 ${compact ? "w-9 px-0" : ""} ${className}`}
    >
      <Icon className="size-4" aria-hidden="true" />
      {!compact && <span>{LABEL[shown]}</span>}
    </button>
  );
}
