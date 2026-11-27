"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Reveal, SplitHeading, Tilt } from "./kinetic";

interface Item { n: string; t: string; d: string; more: string; soon?: boolean; tone: string }
const ITEMS: Item[] = [
  { n: "01", t: "Brief & rubric", d: "Describe the role, get a scorecard.", more: "A seven-dimension rubric is drafted from your brief. Edit weights per job; every version is kept so you can see what changed.", tone: "from-orange-100 to-pink-100" },
  { n: "02", t: "Sourcing", d: "Profiles that fit, found for you.", more: "Start, pause, resume or stop sourcing independently of scoring. Duplicates are merged into a single candidate card.", tone: "from-pink-100 to-violet-100" },
  { n: "03", t: "Scoring", d: "Every candidate, same yardstick.", more: "Each profile is graded dimension by dimension with reasons you can read, not a black-box number.", tone: "from-violet-100 to-blue-100" },
  { n: "04", t: "Resume vault", d: "Profiles and CVs, kept and audited.", more: "Approved profiles and original resume files live in your workspace. Every view and download is logged.", tone: "from-blue-100 to-cyan-100" },
  { n: "05", t: "Pipeline", d: "Eleven stages, one board.", more: "Drag candidates from new to hired. Talent pool and team roles keep everyone aligned.", tone: "from-orange-100 to-amber-100" },
  { n: "06", t: "Outreach", d: "Messages that sound like you.", more: "Personalised outreach drafted for your approval.", soon: true, tone: "from-slate-100 to-slate-200" },
  { n: "07", t: "Interviews & scheduling", d: "From reply to calendar invite.", more: "Screening and scheduling handled with you in control.", soon: true, tone: "from-slate-100 to-slate-200" },
];

export function Journey() {
  const [open, setOpen] = useState<string | null>("01");
  return (
    <section id="journey" className="relative px-4 py-28 sm:px-6" aria-labelledby="journey-title">
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-2)]">04 · The journey</p>
        <SplitHeading text="Every step of the hire, in one place." accent={["hire"]} className="mt-4 max-w-3xl text-4xl font-extrabold leading-tight sm:text-6xl" />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map((it, i) => {
            const isOpen = open === it.n;
            return (
              <Reveal key={it.n} delay={(i % 3) * 0.08} className={i === 0 ? "lg:col-span-2" : ""}>
                <Tilt className="h-full">
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.n)}
                    className={`group relative h-full w-full overflow-hidden rounded-3xl border border-[var(--line)] bg-gradient-to-br ${it.tone} p-6 text-left transition-shadow hover:shadow-xl`}>
                    <div className="flex items-start justify-between">
                      <span className="font-mono text-xs">{it.n}</span>
                      <span className="flex items-center gap-2">
                        {it.soon && <span className="rounded-full bg-black/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Coming soon</span>}
                        <motion.span animate={{ rotate: isOpen ? 45 : 0 }} className="flex size-7 items-center justify-center rounded-full bg-white/80"><Plus className="size-4" aria-hidden="true" /></motion.span>
                      </span>
                    </div>
                    <h3 className="serif mt-10 text-3xl">{it.t}</h3>
                    <p className="mt-1 text-sm text-[var(--ink-2)]">{it.d}</p>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35 }} className="overflow-hidden text-sm leading-relaxed">
                          <span className="block pt-3">{it.more}</span>
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </button>
                </Tilt>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
