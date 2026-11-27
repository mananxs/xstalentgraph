"use client";

import { motion, useMotionValueEvent, useTransform } from "framer-motion";
import { BadgeCheck, FileText, ListChecks, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { AGENT_STEPS } from "./data";
import { usePinned } from "./kinetic";

const ICONS = [FileText, Search, ListChecks, Sparkles, BadgeCheck];
const SHORT = ["Brief", "Search", "Capture", "Score", "Approve"];

/** Pinned diagram: a line draws through five nodes as you scroll; each lights up with its description. */
export function Workflow() {
  const { ref, progress } = usePinned();
  const [active, setActive] = useState(0);
  useMotionValueEvent(progress, "change", (p) => setActive(Math.max(0, Math.min(4, Math.floor((p - 0.08) / 0.17)))));
  const path = useTransform(progress, [0.08, 0.92], [0, 1]);
  return (
    <section id="flow" ref={ref} className="relative h-[300vh]" aria-labelledby="flow-title">
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden px-4">
        <div aria-hidden="true" className="mesh absolute inset-0 -z-10 opacity-60" />
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-2)]">03 · How it works</p>
        <h2 id="flow-title" className="mt-3 text-center text-4xl font-extrabold sm:text-6xl">From brief to <span className="serif">shortlist.</span></h2>
        <div className="relative mt-14 w-full max-w-4xl">
          <svg viewBox="0 0 800 20" preserveAspectRatio="none" className="absolute left-[10%] right-[10%] top-7 hidden h-5 w-4/5 sm:block" aria-hidden="true">
            <line x1="0" y1="10" x2="800" y2="10" stroke="rgb(0 0 0 / 0.1)" strokeWidth="2" strokeDasharray="6 8" />
            <motion.line x1="0" y1="10" x2="800" y2="10" stroke="url(#wf)" strokeWidth="3" strokeLinecap="round" style={{ pathLength: path }} />
            <defs><linearGradient id="wf"><stop offset="0" stopColor="#ff9a62" /><stop offset="1" stopColor="#8b5cf6" /></linearGradient></defs>
          </svg>
          <ol className="relative grid grid-cols-5 gap-2">
            {SHORT.map((s, i) => {
              const Icon = ICONS[i]!;
              const on = i <= active;
              return (
                <li key={s} className="flex flex-col items-center text-center">
                  <motion.span animate={{ scale: i === active ? 1.18 : 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}
                    className={`relative flex size-14 items-center justify-center rounded-2xl border transition-colors duration-500 ${on ? "grad-warm border-transparent text-white shadow-lg" : "border-[var(--line)] bg-white text-[var(--ink-2)]"}`}>
                    <Icon className="size-6" aria-hidden="true" />
                    {i === active && <span className="ring-pulse absolute inset-0 rounded-2xl" aria-hidden="true" />}
                  </motion.span>
                  <span className={`mt-3 text-xs font-semibold sm:text-sm ${on ? "" : "text-[var(--ink-2)]/60"}`}>{s}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="glass mt-12 min-h-24 w-full max-w-xl rounded-3xl p-6 text-center" aria-live="polite">
          <motion.p key={active} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-lg font-medium">{AGENT_STEPS[active]}</motion.p>
        </div>
      </div>
    </section>
  );
}
