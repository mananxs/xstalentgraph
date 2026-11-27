"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { Menu, Network, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { APP_HREF } from "./data";
import { Magnetic, scrollToId } from "./kinetic";
import { ThemeToggle } from "../ThemeToggle";

const LINKS = [["journey", "Product"], ["flow", "How it works"], ["hire", "Try it"], ["faq", "FAQ"]] as const;

export function Nav() {
  const [open, setOpen] = useState(false);
  const [solid, setSolid] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (y) => setSolid(y > 24));
  const go = (id: string) => { setOpen(false); scrollToId(id); };

  return (
    <motion.header initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${solid ? "py-2" : "py-4"}`}>
      <nav aria-label="Primary" className={`mx-auto flex max-w-6xl items-center justify-between rounded-full px-4 transition-all duration-300 sm:px-5 ${solid ? "glass h-12" : "h-14"}`}>
        <Link href="/" aria-label="XS-Hunt home" className="flex items-center gap-2">
          <span className="grad-warm flex size-8 items-center justify-center rounded-xl text-white shadow-sm"><Network className="size-4" aria-hidden="true" /></span>
          <span className="text-[17px] font-extrabold tracking-tight">XS-Hunt</span>
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map(([id, label]) => (
            <li key={id}><button type="button" onClick={() => go(id)} className="rounded-full px-3.5 py-1.5 text-sm font-medium text-[var(--ink-2)] transition-colors hover:bg-black/5 hover:text-[var(--ink)]">{label}</button></li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link href={APP_HREF} className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] hover:text-[var(--ink)] sm:inline">Sign in</Link>
          <Magnetic strength={0.25}>
            <Link href={APP_HREF} className="inline-flex h-9 items-center rounded-full bg-[var(--ink)] px-4 text-sm font-semibold text-white transition-transform hover:scale-[1.04]">Start free</Link>
          </Magnetic>
          <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--line)] bg-white/70 md:hidden">
            {open ? <X className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="glass mx-4 mt-2 rounded-3xl p-3 md:hidden">
            {LINKS.map(([id, label]) => <button key={id} type="button" onClick={() => go(id)} className="block w-full rounded-2xl px-4 py-3 text-left text-base font-medium hover:bg-black/5">{label}</button>)}
            <Link href={APP_HREF} className="block rounded-2xl px-4 py-3 text-base font-medium hover:bg-black/5">Sign in</Link>
            <div className="px-3 py-2"><ThemeToggle /></div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
