"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

const TABS = [
  { n: "01", title: "The brief", sub: "Describe the role in plain English" },
  { n: "02", title: "Ranked matches", sub: "Every profile judged against the full brief" },
  { n: "03", title: "Role pool", sub: "Everyone found is kept for good" },
] as const;
const DURATION = 6000;

const MATCHES = [["Sarah M.", "Staff Engineer · Berlin", "Open to work"], ["Tyler L.", "Backend Lead · Lisbon", "In seat 3y 2m"], ["Ryan S.", "Senior SWE · Remote", "Open to work"]] as const;

function BriefCard() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs"><span className="font-semibold">Brief</span><span className="flex items-center gap-1.5 text-[var(--ink-2)]"><i className="size-1.5 animate-pulse rounded-full bg-violet-500" />reading the brief</span></div>
      <p className="rounded-xl border border-[var(--line)] bg-white p-3 text-sm">Senior backend engineer, Go, payments, remote EU</p>
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-2)]">Structured filters you can correct</p>
      <div className="flex flex-wrap gap-1.5">{["Senior", "Backend", "Go", "Payments", "Remote · EU"].map((c, i) => <motion.span key={c} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 * i }} className="rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-xs">{c}</motion.span>)}</div>
      <div className="rounded-xl bg-gradient-to-br from-orange-50 to-pink-50 p-3 text-xs"><p className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-2)]">Rubric drafted · 7 dimensions</p><p className="mt-1">The scorecard grades candidates against it. You review it; you don&apos;t build it.</p></div>
    </div>
  );
}
function MatchesCard() {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-xs"><span className="font-semibold">Searching profiles</span><span className="flex items-center gap-1.5 text-violet-700"><i className="size-1.5 animate-pulse rounded-full bg-violet-500" />live</span></div>
      {MATCHES.map(([n, r, t], i) => (
        <motion.div key={n} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 * i }} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white p-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-orange-100 to-violet-100 text-[11px] font-bold">{n.slice(0, 2).toUpperCase()}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{n}</p><p className="truncate text-xs text-[var(--ink-2)]">{r}</p></div>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{t}</span>
        </motion.div>
      ))}
      <p className="text-center text-xs text-[var(--ink-2)]">Searches are free to refine</p>
    </div>
  );
}
function PoolCard() {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-xs"><span className="font-semibold">Senior Backend Engineer · pool</span><span className="tabular-nums font-bold">352</span></div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-2)]">Today</p>
      {([["Jake M.", "Platform Engineer · Munich"], ["Emily O.", "Senior Go Developer · Remote"]] as const).map(([n, r], i) => (
        <motion.div key={n} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 * i }} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white p-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-pink-100 to-blue-100 text-[11px] font-bold">{n.slice(0, 2).toUpperCase()}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{n}</p><p className="truncate text-xs text-[var(--ink-2)]">{r}</p></div>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">new</span>
        </motion.div>
      ))}
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-2)]">Yesterday · +14</p>
      <p className="rounded-xl bg-gradient-to-br from-violet-50 to-blue-50 p-3 text-xs">Grouped by day found, never re-shown.</p>
    </div>
  );
}
const CARDS = [BriefCard, MatchesCard, PoolCard];

/** Three-step strip under the hero: a progress line fills on the active step, the cards below swap with it. Click any step to jump. */
export function HeroTabs() {
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (hover) return;
    const t = setTimeout(() => { setI((v) => (v + 1) % 3); setKey((k) => k + 1); }, DURATION);
    return () => clearTimeout(t);
  }, [i, hover, key]);
  const go = (n: number) => { setI((n + 3) % 3); setKey((k) => k + 1); };

  return (
    <div className="relative mx-auto mt-8 max-w-6xl px-4 pb-20 sm:px-6" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <div role="tablist" aria-label="How a search runs" className="grid gap-4 sm:grid-cols-3">
        {TABS.map((t, n) => (
          <button key={t.n} role="tab" aria-selected={i === n} type="button" onClick={() => go(n)} className="group text-left">
            <span className="relative block h-[2px] w-full overflow-hidden bg-black/10">
              {i === n && <motion.span key={`${key}-${hover}`} initial={{ width: 0 }} animate={{ width: hover ? "100%" : "100%" }} transition={{ duration: hover ? 0.01 : DURATION / 1000, ease: "linear" }} className="absolute inset-y-0 left-0 bg-[var(--ink)]" />}
            </span>
            <span className={`mt-3 flex items-baseline gap-2 transition-opacity ${i === n ? "opacity-100" : "opacity-50 group-hover:opacity-80"}`}>
              <span className="font-mono text-[10px] tracking-wider">{t.n}</span>
              <span className="serif text-2xl">{t.title}</span>
            </span>
            <span className={`mt-0.5 block text-xs text-[var(--ink-2)] transition-opacity ${i === n ? "opacity-100" : "opacity-60"}`}>{t.sub}</span>
          </button>
        ))}
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {CARDS.map((Card, n) => (
          <motion.div key={n} animate={{ scale: i === n ? 1 : 0.96, opacity: i === n ? 1 : 0.55, y: i === n ? -6 : 0 }} transition={{ type: "spring", stiffness: 220, damping: 24 }}
            className={`rounded-3xl border bg-white/80 p-5 backdrop-blur ${i === n ? "border-violet-200 shadow-[0_24px_60px_-24px_rgb(109_76_255/0.45)]" : "border-[var(--line)]"}`}>
            <AnimatePresence mode="wait"><motion.div key={`${n}-${i === n}`} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Card /></motion.div></AnimatePresence>
          </motion.div>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-center gap-3 text-xs text-[var(--ink-2)]">
        <button type="button" aria-label="Previous step" onClick={() => go(i - 1)} className="flex size-8 items-center justify-center rounded-full border border-[var(--line)] bg-white/70 hover:bg-white"><ChevronLeft className="size-4" aria-hidden="true" /></button>
        <span className="tabular-nums">{i + 1} / 3</span>
        <button type="button" aria-label="Next step" onClick={() => go(i + 1)} className="flex size-8 items-center justify-center rounded-full border border-[var(--line)] bg-white/70 hover:bg-white"><ChevronRight className="size-4" aria-hidden="true" /></button>
      </div>
    </div>
  );
}
