"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { APP_HREF, SAMPLE_PROMPTS, type SourceId } from "./data";
import { rankCandidates } from "./demoSearch";
import { CountUp, SplitHeading } from "./kinetic";

const ALL = new Set<SourceId>(["naukri", "linkedin", "cutshort", "github"]);

/** Interactive sandbox. Results come from a small set of fictional demo profiles. */
export function HireBox() {
  const [text, setText] = useState(SAMPLE_PROMPTS[0]!);
  const [run, setRun] = useState(SAMPLE_PROMPTS[0]!);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const h = (e: Event) => { const t = (e as CustomEvent<string>).detail; if (t) { setText(t); go(t); } };
    window.addEventListener("xs:prompt", h);
    return () => window.removeEventListener("xs:prompt", h);
  });
  function go(t: string) {
    setBusy(true);
    setTimeout(() => { setRun(t); setBusy(false); }, 650);
  }
  const { ranked } = useMemo(() => rankCandidates(run, ALL), [run]);
  const top = ranked.slice(0, 4);
  return (
    <section id="hire" className="relative overflow-hidden px-4 py-28 sm:px-6" aria-labelledby="hire-title">
      <div aria-hidden="true" className="mesh absolute inset-0 -z-10" />
      <div className="mx-auto max-w-4xl text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-2)]">05 · Try it</p>
        <SplitHeading text="Who are you hiring?" accent={["hiring"]} className="mt-4 text-5xl font-extrabold sm:text-7xl" />
        <form onSubmit={(e) => { e.preventDefault(); go(text); }} className="glass mx-auto mt-10 flex h-[60px] max-w-2xl items-center gap-2 rounded-full p-2 pl-6">
          <label htmlFor="hb" className="sr-only">Describe who you are hiring</label>
          <input id="hb" value={text} onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
          <button type="submit" className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[var(--ink)] px-5 text-sm font-semibold text-white transition-transform hover:scale-105 active:scale-95">Find <ArrowRight className="size-4" aria-hidden="true" /></button>
        </form>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {SAMPLE_PROMPTS.map((p) => <button key={p} type="button" onClick={() => { setText(p); go(p); }} className="rounded-full border border-[var(--line)] bg-white/70 px-3 py-1.5 text-xs text-[var(--ink-2)] transition-colors hover:bg-white hover:text-[var(--ink)]">{p}</button>)}
        </div>
        <div className="mt-10 min-h-[320px] text-left" aria-live="polite">
          {busy ? (
            <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-white/70" style={{ animationDelay: `${i * 120}ms` }} />)}</div>
          ) : top.length === 0 ? (
            <p className="rounded-2xl bg-white/70 p-6 text-center text-sm text-[var(--ink-2)]">No demo profiles match. Try naming a skill and a city.</p>
          ) : (
            <AnimatePresence mode="popLayout">
              {top.map((r, i) => (
                <motion.div key={r.candidate.id + run} layout initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="mb-3 flex items-center gap-4 rounded-2xl border border-[var(--line)] bg-white/85 p-4 backdrop-blur">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-100 to-violet-200 text-sm font-bold">{r.candidate.name.split(" ").map((w) => w[0]).join("")}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.candidate.name}</p>
                    <p className="truncate text-sm text-[var(--ink-2)]">{r.candidate.title} · {r.candidate.city} · {r.candidate.years}y</p>
                    <div className="mt-1.5 h-1.5 rounded-full bg-black/10"><motion.div initial={{ width: 0 }} animate={{ width: `${r.score}%` }} transition={{ duration: 0.9, delay: 0.2 + i * 0.08 }} className="grad-warm h-full rounded-full" /></div>
                  </div>
                  <span className="text-2xl font-extrabold tabular-nums"><CountUp to={r.score} /></span>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--ink-2)]">Demo profiles are fictional. <Link href={APP_HREF} className="underline underline-offset-2">Run it on your own roles</Link>.</p>
      </div>
    </section>
  );
}
