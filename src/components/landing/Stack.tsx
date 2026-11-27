"use client";

import { motion, useTransform } from "framer-motion";
import { Layers, Search, Star, Users } from "lucide-react";
import { SplitHeading, Tilt, usePinned } from "./kinetic";

const CARDS = [
  { icon: Search, t: "Sourcing agent", d: "Finds profiles that fit the brief and keeps the pool fresh.", x: -260, y: -40, r: -6 },
  { icon: Star, t: "Scoring agent", d: "Grades every candidate on a seven-dimension rubric.", x: 0, y: 30, r: 2 },
  { icon: Users, t: "Pipeline agent", d: "Keeps shortlists and stages tidy, with you in the loop.", x: 260, y: -30, r: 6 },
] as const;

/** Cards fly in from the sides as you scroll and settle into a stack. */
export function Stack() {
  const { ref, progress } = usePinned();
  const head = useTransform(progress, [0, 0.3], [1, 1]);
  return (
    <section ref={ref} className="relative h-[220vh]" aria-labelledby="stack-title">
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden px-4">
        <motion.div style={{ opacity: head }} className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-2)]">02 · The team</p>
          <SplitHeading text="One brief. A whole team behind it." accent={["team"]} className="mx-auto mt-4 max-w-3xl text-4xl font-extrabold leading-tight sm:text-6xl" />
        </motion.div>
        <div className="relative mt-12 h-64 w-full max-w-5xl">
          {CARDS.map((c, i) => <StackCard key={c.t} c={c} i={i} progress={progress} />)}
        </div>
      </div>
    </section>
  );
}

function StackCard({ c, i, progress }: { c: (typeof CARDS)[number]; i: number; progress: ReturnType<typeof usePinned>["progress"] }) {
  const k = i * 0.08;
  const x = useTransform(progress, [0.05 + k, 0.55 + k], [c.x * 2.4, c.x * 0.9]);
  const y = useTransform(progress, [0.05 + k, 0.55 + k], [200, c.y]);
  const rot = useTransform(progress, [0.05 + k, 0.55 + k], [c.r * 4, c.r]);
  const op = useTransform(progress, [0.05 + k, 0.25 + k], [0, 1]);
  const Icon = c.icon;
  return (
    <motion.div style={{ x, y, rotate: rot, opacity: op }} className="absolute left-1/2 top-0 w-[min(300px,80vw)] -translate-x-1/2">
      <Tilt className="glass rounded-3xl p-6">
        <span className="grad-warm flex size-11 items-center justify-center rounded-2xl text-white"><Icon className="size-5" aria-hidden="true" /></span>
        <h3 className="mt-4 text-lg font-bold">{c.t}</h3>
        <p className="mt-1 text-sm leading-relaxed text-[var(--ink-2)]">{c.d}</p>
        <Layers className="absolute right-5 top-5 size-4 text-black/20" aria-hidden="true" />
      </Tilt>
    </motion.div>
  );
}
