"use client";

import { motion, useMotionValueEvent, useTransform } from "framer-motion";
import { useState } from "react";
import { usePinned } from "./kinetic";

const BRIEF = "Staff backend engineer, payments experience, remote across Europe. Strong with Go. Senior enough to lead a squad.";
const CHIPS = ["Staff level", "Backend", "Payments", "Go", "Remote · Europe", "Team lead"];

/** Pinned scroll scene: the sentence types itself as you scroll, then turns into structured filters. */
export function Describe() {
  const { ref, progress } = usePinned();
  const [n, setN] = useState(0);
  const [chips, setChips] = useState(0);
  useMotionValueEvent(progress, "change", (p) => {
    setN(Math.min(BRIEF.length, Math.floor(Math.max(0, p - 0.05) / 0.5 * BRIEF.length)));
    setChips(Math.max(0, Math.min(CHIPS.length, Math.floor((p - 0.55) / 0.07))));
  });
  const scale = useTransform(progress, [0, 0.5, 1], [0.94, 1, 1.02]);
  const bgShift = useTransform(progress, [0, 1], ["0%", "60%"]);
  return (
    <section ref={ref} className="relative h-[240vh]" aria-labelledby="describe-title">
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <motion.div aria-hidden="true" style={{ backgroundPositionX: bgShift }} className="grad-sunrise absolute inset-0 -z-10 opacity-70 [background-size:200%_100%]" />
        <div className="mx-auto w-full max-w-4xl px-4 text-center sm:px-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-2)]">01 · Describe</p>
          <h2 id="describe-title" className="mt-4 text-4xl font-extrabold leading-tight sm:text-6xl">Just say who you <span className="serif">need.</span></h2>
          <motion.div style={{ scale }} className="glass mx-auto mt-10 max-w-2xl rounded-3xl p-6 text-left">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-2)]">New role</p>
            <p className="mt-2 min-h-[5.5rem] text-lg leading-relaxed sm:text-xl">{BRIEF.slice(0, n)}<span className="caret inline-block h-5 w-px translate-y-1 bg-[var(--ink)]" aria-hidden="true" /></p>
            <div className="mt-4 flex min-h-9 flex-wrap gap-2">
              {CHIPS.slice(0, chips).map((c) => (
                <motion.span key={c} initial={{ opacity: 0, scale: 0.7, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="rounded-full bg-white px-3 py-1.5 text-sm font-medium shadow-sm">{c}</motion.span>
              ))}
            </div>
          </motion.div>
          <p className="mx-auto mt-6 max-w-md text-sm text-[var(--ink-2)]">No boolean strings. No keyword soup. Your words become filters and a scoring rubric you can edit.</p>
        </div>
      </div>
    </section>
  );
}
