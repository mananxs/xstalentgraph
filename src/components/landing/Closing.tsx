"use client";

import { AnimatePresence, motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Network, Plus } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { APP_HREF, DEMO_HREF, FAQS } from "./data";
import { CountUp, Magnetic, Reveal, SplitHeading } from "./kinetic";

const WORDS = ["Ask.", "Approve.", "Hire."];

export function Humans() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const x = useTransform(scrollYProgress, [0, 1], ["8%", "-12%"]);
  return (
    <section ref={ref} className="relative overflow-hidden px-4 py-32 sm:px-6" aria-labelledby="humans-title">
      <motion.div aria-hidden="true" style={{ x }} className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 -translate-y-1/2 whitespace-nowrap text-[22vw] font-extrabold leading-none text-black/[0.04]">Ask Approve Hire</motion.div>
      <div className="mx-auto max-w-4xl text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-2)]">06 · You stay in charge</p>
        <h2 id="humans-title" className="mt-4 text-5xl font-extrabold leading-[1.02] sm:text-8xl">
          {WORDS.map((w, i) => (
            <span key={w} className="block overflow-hidden pb-2"><motion.span initial={{ y: "110%" }} whileInView={{ y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15, duration: 0.85, ease: [0.22, 1, 0.36, 1] }} className={`inline-block ${i === 2 ? "grad-text serif" : ""}`}>{w}</motion.span></span>
          ))}
        </h2>
        <Reveal delay={0.4}><p className="mx-auto mt-6 max-w-lg text-[15px] text-[var(--ink-2)]">Agents do the legwork. People make the decisions that matter.</p></Reveal>
      </div>
    </section>
  );
}

/** Only facts that are true of the product. */
const FACTS = [["7", "scoring dimensions"], ["11", "pipeline stages"], ["3", "independent run controls"], ["100", "% of decisions are yours"]] as const;
export function Stats() {
  return (
    <section className="grad-sunrise px-4 py-20 sm:px-6" aria-label="XS-Hunt at a glance">
      <dl className="mx-auto grid max-w-5xl grid-cols-2 gap-8 text-center md:grid-cols-4">
        {FACTS.map(([n, l]) => (
          <div key={l}><dt className="sr-only">{l}</dt><dd className="text-5xl font-extrabold tabular-nums sm:text-6xl"><CountUp to={Number(n)} /></dd><p className="mt-1 text-sm text-[var(--ink)]/70">{l}</p></div>
        ))}
      </dl>
    </section>
  );
}

const ROLES = ["Software Engineer", "Sales Manager", "Data Analyst", "Product Designer", "Account Executive", "DevOps Engineer", "Marketing Lead", "Finance Manager", "Customer Success", "Recruiter"];
export function RolesMarquee() {
  const row = [...ROLES, ...ROLES];
  return (
    <div className="overflow-hidden border-y border-[var(--line)] bg-white py-5" aria-label="Roles you can hire for">
      <div className="mq-l flex w-max gap-4">{row.map((r, i) => <span key={i} className="rounded-full border border-[var(--line)] px-5 py-2 text-sm font-medium text-[var(--ink-2)]">{r}</span>)}</div>
    </div>
  );
}

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="px-4 py-28 sm:px-6" aria-labelledby="faq-title">
      <div className="mx-auto max-w-3xl">
        <SplitHeading text="Questions, answered." accent={["answered"]} className="text-center text-4xl font-extrabold sm:text-6xl" />
        <div className="mt-12 divide-y divide-[var(--line)] rounded-3xl border border-[var(--line)] bg-white/80">
          {FAQS.map((f, i) => {
            const on = open === i;
            return (
              <div key={f.q}>
                <h3><button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : i)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-base font-semibold">
                  {f.q}<motion.span animate={{ rotate: on ? 45 : 0 }} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black/5"><Plus className="size-4" aria-hidden="true" /></motion.span>
                </button></h3>
                <AnimatePresence initial={false}>{on && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden"><p className="px-6 pb-5 text-sm leading-relaxed text-[var(--ink-2)]">{f.a}</p></motion.div>}</AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-[#0c0c10] px-4 pb-10 pt-24 text-white sm:px-6">
      <div aria-hidden="true" className="drift-a absolute -left-20 -top-20 size-[420px] rounded-full bg-[radial-gradient(circle,#ff8a5c_0%,transparent_65%)] opacity-40 blur-2xl" />
      <div aria-hidden="true" className="drift-b absolute -right-16 top-0 size-[480px] rounded-full bg-[radial-gradient(circle,#8b5cf6_0%,transparent_65%)] opacity-40 blur-2xl" />
      <div className="relative mx-auto max-w-4xl text-center">
        <SplitHeading text="Ready to hire with a team behind you?" accent={["team"]} className="text-4xl font-extrabold leading-tight sm:text-6xl" />
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Magnetic><Link href={APP_HREF} className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[var(--ink)]">Try for free <ArrowRight className="size-4" aria-hidden="true" /></Link></Magnetic>
          <Magnetic><a href={DEMO_HREF} className="inline-flex h-12 items-center rounded-full border border-white/30 px-7 text-sm font-semibold hover:bg-white/10">Contact sales</a></Magnetic>
        </div>
      </div>
      <div className="relative mx-auto mt-20 flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-sm text-white/60">
        <span className="flex items-center gap-2 font-bold text-white"><Network className="size-4" aria-hidden="true" />XS-Hunt</span>
        <span>© {new Date().getFullYear()} XS-Hunt</span>
      </div>
    </footer>
  );
}
