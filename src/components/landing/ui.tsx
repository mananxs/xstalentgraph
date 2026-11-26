import type { ReactNode } from "react";
import { INTEGRATION_LOGOS } from "../BrandLogos";
import { SOURCE_LABEL, type SourceId } from "./data";

/** Shared primitives so every button and input keeps the same height, radius and focus ring. */
export const btnPrimary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-strong focus-visible:outline-accent";
export const btnSecondary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-50";

export function SectionHeader({ tag, title, children }: { tag: string; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="section-tag">{tag}</p>
      <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">{title}</h2>
      {children && <p className="mt-3 text-base text-zinc-600">{children}</p>}
    </div>
  );
}

export function SourceBadge({ source }: { source: SourceId }) {
  const Logo = INTEGRATION_LOGOS[source];
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-600">
      <Logo size={12} className={source === "github" ? "text-zinc-800" : "grayscale"} />
      {SOURCE_LABEL[source]}
    </span>
  );
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-medium text-zinc-700 ring-1 ring-zinc-200">
      {initials(name)}
    </span>
  );
}

/** Compact numeric score chip. Colour = tier, number carries the meaning (never colour alone). */
export function ScoreChip({ score }: { score: number }) {
  const tone = score >= 80 ? "text-tier-high bg-emerald-50 border-emerald-200" : score >= 60 ? "text-tier-mid bg-amber-50 border-amber-200" : "text-tier-low bg-rose-50 border-rose-200";
  return <span className={`inline-flex h-6 min-w-11 items-center justify-center rounded-md border px-1.5 text-xs font-semibold tabular-nums ${tone}`}>{score}%</span>;
}
