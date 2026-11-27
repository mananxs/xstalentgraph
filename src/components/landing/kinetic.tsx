"use client";

import Lenis from "lenis";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

/* ───────────── smooth scroll + progress bar ───────────── */
declare global {
  interface Window {
    __lenis?: Lenis;
  }
}

/** Inertial smooth scrolling for the whole page (off for visitors who prefer reduced motion) and a gradient progress bar. */
export function SmoothScroll() {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });
  useEffect(() => {
    if (reduced) return;
    const lenis = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 3), smoothWheel: true });
    window.__lenis = lenis;
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      delete window.__lenis;
    };
  }, [reduced]);
  return <motion.div aria-hidden="true" style={{ scaleX }} className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left grad-warm" />;
}

/** Smooth-scrolls to an element id (Lenis when active, native otherwise). */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const lenis = window.__lenis;
  if (lenis) lenis.scrollTo(el, { offset: -72, duration: 1.4 });
  else el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ───────────── reveal on scroll ───────────── */
export function Reveal({ children, delay = 0, y = 28, className = "", as = "div" }: { children: ReactNode; delay?: number; y?: number; className?: string; as?: ElementType }) {
  const Tag = motion.create(as as "div");
  return (
    <Tag initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }} className={className}>
      {children}
    </Tag>
  );
}

/** Headline whose words rise out of a mask one after another. `accent` words use the serif italic. */
export function SplitHeading({ text, accent = [], className = "", as: As = "h2" }: { text: string; accent?: string[]; className?: string; as?: "h1" | "h2" | "h3" }) {
  const words = text.split(" ");
  const M = motion.create(As);
  return (
    <M initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} transition={{ staggerChildren: 0.06 }} className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} aria-hidden="true" className="inline-block overflow-hidden pb-[0.12em] align-bottom">
          <motion.span variants={{ hidden: { y: "110%" }, show: { y: 0 } }} transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }} className={`inline-block ${accent.includes(w.replace(/[.,]/g, "")) ? "serif" : ""}`}>
            {w}&nbsp;
          </motion.span>
        </span>
      ))}
    </M>
  );
}

/* ───────────── magnetic buttons, tilt cards ───────────── */
export function Magnetic({ children, strength = 0.35, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 16 });
  const sy = useSpring(y, { stiffness: 220, damping: 16 });
  return (
    <motion.div ref={ref} style={{ x: sx, y: sy }} className={`inline-block ${className}`}
      onPointerMove={(e) => { const r = ref.current!.getBoundingClientRect(); x.set((e.clientX - (r.left + r.width / 2)) * strength); y.set((e.clientY - (r.top + r.height / 2)) * strength); }}
      onPointerLeave={() => { x.set(0); y.set(0); }}>
      {children}
    </motion.div>
  );
}

export function Tilt({ children, className = "", max = 7 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 });
  const gx = useMotionValue(50);
  const gy = useMotionValue(50);
  const glare = useTransform([gx, gy], ([a, b]) => `radial-gradient(260px circle at ${a}% ${b}%, rgb(255 255 255 / 0.55), transparent 60%)`);
  return (
    <motion.div ref={ref} style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }} className={`relative ${className}`}
      onPointerMove={(e) => { const r = ref.current!.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width; const py = (e.clientY - r.top) / r.height; ry.set((px - 0.5) * max * 2); rx.set(-(py - 0.5) * max * 2); gx.set(px * 100); gy.set(py * 100); }}
      onPointerLeave={() => { rx.set(0); ry.set(0); }}>
      {children}
      <motion.span aria-hidden="true" style={{ background: glare }} className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 hover:opacity-100" />
    </motion.div>
  );
}

/* ───────────── counters + typewriter ───────────── */
export function CountUp({ to, suffix = "", duration = 1.6 }: { to: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const c = animate(0, to, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: (n) => setV(Math.round(n)) });
    return () => c.stop();
  }, [inView, to, duration]);
  return <span ref={ref} className="tabular-nums">{v}{suffix}</span>;
}

/** Types each text in turn, holds, deletes, moves on. Static first text for reduced motion. */
export function useTypewriter(texts: string[], opts: { type?: number; del?: number; hold?: number; paused?: boolean } = {}) {
  const { type = 42, del = 22, hold = 1400, paused = false } = opts;
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [phase, setPhase] = useState<"type" | "hold" | "del">("type");
  useEffect(() => {
    if (reduced || paused) return;
    const full = texts[i % texts.length] ?? "";
    let t: ReturnType<typeof setTimeout>;
    if (phase === "type") t = n < full.length ? setTimeout(() => setN(n + 1), type) : setTimeout(() => setPhase("hold"), 0);
    else if (phase === "hold") t = setTimeout(() => setPhase("del"), hold);
    else t = n > 0 ? setTimeout(() => setN(n - 1), del) : setTimeout(() => { setI((i + 1) % texts.length); setPhase("type"); }, 0);
    return () => clearTimeout(t);
  }, [i, n, phase, texts, type, del, hold, reduced, paused]);
  if (reduced) return texts[0] ?? "";
  return (texts[i % texts.length] ?? "").slice(0, n);
}

/** A 0..1 scroll progress for a tall pinned section. */
export function usePinned() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  return { ref, progress: scrollYProgress };
}
