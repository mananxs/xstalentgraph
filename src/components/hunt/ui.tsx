"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { INTEGRATION_LOGOS } from "../BrandLogos";
import { SOURCE_LABEL, TIER_HELP, TIER_LABEL, type Tier } from "@/lib/hunt";

/** Shared look: white cards, #E4E4E7 hairlines, indigo accent, green / amber / red states. Compact h-8 / h-9 controls. */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong border-transparent",
  secondary: "bg-white text-zinc-900 border-zinc-200 hover:bg-zinc-50",
  ghost: "bg-transparent text-zinc-700 border-transparent hover:bg-zinc-100",
  danger: "bg-white text-rose-700 border-rose-200 hover:bg-rose-50",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 border-transparent",
};

export function Button({ variant = "secondary", size = "md", loading, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm"} ${VARIANT[variant]} ${className}`}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

type Tone = "neutral" | "green" | "amber" | "red" | "indigo";
const TONE: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 border-zinc-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  red: "bg-rose-50 text-rose-700 border-rose-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
};
export function Badge({ tone = "neutral", children, title, className = "" }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}

const TIER_TONE: Record<Tier, Tone> = { strong: "green", potential: "indigo", weak: "red", provisional: "amber", needs_info: "amber" };
export function TierBadge({ tier }: { tier: Tier | null }) {
  if (!tier) return <Badge title="Not evaluated under the job's rubric yet.">Not evaluated</Badge>;
  return (
    <Badge tone={TIER_TONE[tier]} title={TIER_HELP[tier]}>
      {TIER_LABEL[tier]}
    </Badge>
  );
}

/** Where a candidate came from. Always the platform, never an evaluation engine. */
export function SourceBadge({ source, size = 14 }: { source: string; size?: number }) {
  const Logo = (INTEGRATION_LOGOS as Record<string, (p: { size?: number; className?: string }) => ReactNode>)[source];
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700">
      {Logo ? <Logo size={size} /> : <span className="size-3 rounded-sm bg-zinc-300" aria-hidden="true" />}
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

export function Avatar({ name, src, size = 36 }: { name: string | null; src?: string | null; size?: number }) {
  const initials = (name ?? "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="rounded-full bg-zinc-100 object-cover" style={{ width: size, height: size }} loading="lazy" />
  ) : (
    <span aria-hidden="true" style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
      {initials}
    </span>
  );
}

export function ProgressBar({ value, max, tone = "indigo", label }: { value: number; max: number; tone?: "indigo" | "green" | "amber"; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = tone === "green" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-accent";
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-zinc-200 bg-white shadow-sm ${className}`}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-zinc-950">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-zinc-100 ${className}`} />;
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 text-zinc-400">{icon}</div>}
      <h2 className="text-base font-medium text-zinc-950">{title}</h2>
      {children && <div className="mt-1.5 max-w-md text-sm text-zinc-600">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "red", children }: { tone?: "red" | "amber" | "green" | "indigo"; children: ReactNode }) {
  const t = { red: "border-rose-200 bg-rose-50 text-rose-800", amber: "border-amber-200 bg-amber-50 text-amber-900", green: "border-emerald-200 bg-emerald-50 text-emerald-900", indigo: "border-indigo-200 bg-indigo-50 text-indigo-900" }[tone];
  return (
    <p role={tone === "red" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${t}`}>
      {children}
    </p>
  );
}

export const inputClass = "h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-zinc-50";
