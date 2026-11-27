"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { ArrowRight, Check, Loader2, Network, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { APP_HREF, DEMO_HREF } from "./data";
import { Magnetic, scrollToId, useTypewriter } from "./kinetic";
import { HeroTabs } from "./HeroTabs";

const PROMPTS = ["a senior sales manager from Dallas with at least 3 years of experience", "a backend engineer who has shipped payments systems", "a product designer for a fast-growing fintech", "a data analyst, 4 years, open to remote"];
const VERBS = ["source", "rank", "review", "shortlist"];
const STEPS = ["Reading your brief", "Searching profiles", "Scoring every match", "Waiting for your approval"];

export function Hero() {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const typed = useTypewriter(PROMPTS, { paused: focused || value.length > 0 });
  const verb = useTypewriter(VERBS, { type: 70, del: 40, hold: 1600 });
  const ref = useRef<HTMLElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 60, damping: 20 });
  const sy = useSpring(my, { stiffness: 60, damping: 20 });
  const b1x = useTransform(sx, (v) => v * -40); const b1y = useTransform(sy, (v) => v * -30);
  const b2x = useTransform(sx, (v) => v * 60); const b2y = useTransform(sy, (v) => v * 40);
  const c1x = useTransform(sx, (v) => v * 24); const c1y = useTransform(sy, (v) => v * 18);
  const c2x = useTransform(sx, (v) => v * -30); const c2y = useTransform(sy, (v) => v * -22);
  const [step, setStep] = useState(0);
  useEffect(() => { const t = setInterval(() => setStep((s) => (s + 1) % (STEPS.length + 1)), 1500); return () => clearInterval(t); }, []);

  const submit = (text: string) => {
    window.dispatchEvent(new CustomEvent("xs:prompt", { detail: text || PROMPTS[0] }));
    scrollToId("hire");
  };

  return (
    <section ref={ref} onPointerMove={(e) => { const r = ref.current!.getBoundingClientRect(); mx.set((e.clientX - r.left) / r.width - 0.5); my.set((e.clientY - r.top) / r.height - 0.5); }}
      className="relative isolate overflow-hidden pt-28 sm:pt-32" aria-labelledby="hero-title">
      {/* gradient mesh */}
      <div aria-hidden="true" className="mesh absolute inset-0 -z-20" />
      <motion.div aria-hidden="true" style={{ x: b1x, y: b1y }} className="drift-a absolute -left-24 top-10 -z-10 size-[460px] rounded-full bg-[radial-gradient(circle,#ffb88a_0%,transparent_65%)] opacity-80 blur-2xl" />
      <motion.div aria-hidden="true" style={{ x: b2x, y: b2y }} className="drift-b absolute -right-20 top-0 -z-10 size-[560px] rounded-full bg-[radial-gradient(circle,#ff8fb8_0%,#c4a6ff_45%,transparent_70%)] opacity-70 blur-2xl" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-white" />

      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-10 sm:px-6 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ink-2)]">XS-Hunt · end-to-end AI recruiter for hiring teams</motion.p>
          <h1 id="hero-title" className="mt-4 text-[44px] font-extrabold leading-[0.98] sm:text-[68px]">
            {["Your", "ambition", "just", "got", "a", "team."].map((w, i) => (
              <span key={i} className="inline-block overflow-hidden pb-[0.1em] align-bottom"><motion.span initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ delay: 0.15 + i * 0.07, duration: 0.8, ease: [0.22, 1, 0.36, 1] }} className={`inline-block ${w === "team." ? "serif" : ""}`}>{w}&nbsp;</motion.span></span>
            ))}
          </h1>
          <p className="mt-3 h-12 text-[34px] font-semibold leading-none text-[var(--ink-2)]/60 sm:h-16 sm:text-[52px]" aria-live="off">
            Let agents <span className="grad-text">{verb}</span><span className="caret ml-0.5 inline-block w-[3px] translate-y-1 bg-[var(--ink)]/60" style={{ height: "0.85em" }} aria-hidden="true" />.
          </p>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }} className="mt-6 max-w-md text-[15px] leading-relaxed text-[var(--ink-2)]">
            Your entire hiring pipeline, run by agents you direct. Nothing moves forward without your approval.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85 }} className="mt-7 flex flex-wrap gap-3">
            <Magnetic><a href={DEMO_HREF} className="inline-flex h-11 items-center rounded-full bg-[var(--ink)] px-6 text-sm font-semibold text-white transition-transform hover:scale-[1.04]">Contact sales</a></Magnetic>
            <Magnetic><Link href={APP_HREF} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--ink)]/20 bg-white/60 px-6 text-sm font-semibold backdrop-blur transition-all hover:border-[var(--ink)] hover:bg-white">Try for free <ArrowRight className="size-4" aria-hidden="true" /></Link></Magnetic>
          </motion.div>

          {/* prompt pill */}
          <motion.form initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }} onSubmit={(e) => { e.preventDefault(); submit(value); }}
            className="glass mt-9 flex h-[60px] max-w-xl items-center gap-2 rounded-full p-2 pl-6 transition-shadow focus-within:shadow-[0_0_0_3px_rgb(109_76_255/0.25)]">
            <label className="sr-only" htmlFor="hero-prompt">Describe who you are hiring</label>
            <div className="relative min-w-0 flex-1">
              <input id="hero-prompt" value={value} onChange={(e) => setValue(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="w-full bg-transparent text-[15px] outline-none" autoComplete="off" />
              {!value && <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center truncate text-[15px] text-[var(--ink-2)]/70">{focused ? "Describe who you are hiring…" : typed}<span className="caret ml-px inline-block h-4 w-px bg-[var(--ink)]/50" /></span>}
            </div>
            <motion.button type="submit" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} aria-label="Run this brief" className="ring-pulse flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-white"><ArrowRight className="size-5" aria-hidden="true" /></motion.button>
          </motion.form>
        </div>

        {/* floating agent window */}
        <div className="relative mx-auto hidden h-[470px] w-full max-w-[520px] lg:block" aria-hidden="true">
          <motion.div style={{ x: c1x, y: c1y }} className="glass absolute right-0 top-4 w-[400px] rounded-3xl p-5">
            <div className="flex items-center gap-3">
              <span className="grad-warm flex size-11 items-center justify-center rounded-2xl text-white"><Network className="size-5" /></span>
              <div><p className="text-sm font-bold">XS-Hunt agent</p><p className="text-xs text-[var(--ink-2)]">Working on: Senior Sales Manager</p></div>
            </div>
            <ol className="mt-4 space-y-2">
              {STEPS.map((s, i) => (
                <li key={s} className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all duration-500 ${i < step ? "bg-white/70" : i === step ? "bg-white shadow-md" : "opacity-40"}`}>
                  {i < step ? <Check className="size-4 text-emerald-600" /> : i === step ? <Loader2 className="size-4 animate-spin text-violet-600" /> : <span className="size-1.5 rounded-full bg-black/25" />}
                  {s}
                </li>
              ))}
            </ol>
          </motion.div>
          <motion.div style={{ x: c2x, y: c2y }} className="glass floaty absolute bottom-6 left-0 w-60 rounded-2xl p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-2)]">Best match</p>
            <div className="mt-2 flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">AI</span><div className="flex-1"><p className="text-sm font-semibold">Ananya Iyer</p><div className="mt-1 h-1.5 rounded-full bg-black/10"><motion.div initial={{ width: 0 }} animate={{ width: "88%" }} transition={{ delay: 1.2, duration: 1.4 }} className="grad-warm h-full rounded-full" /></div></div><span className="text-sm font-bold tabular-nums">88</span></div>
          </motion.div>
          <motion.div style={{ x: c1x, y: c2y }} className="glass floaty absolute right-4 top-[318px] rounded-full px-4 py-2 text-sm font-semibold" >
            <span className="mr-1.5 inline-block size-2 rounded-full bg-emerald-500" />Needs your approval
          </motion.div>
          <Sparkles className="absolute left-16 top-10 size-6 text-violet-400/70" />
        </div>
      </div>

      <HeroTabs />
    </section>
  );
}
