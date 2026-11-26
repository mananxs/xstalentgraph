"use client";

import { ArrowRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "../Logo";
import { APP_HREF } from "./data";
import { btnPrimary } from "./ui";

const LINKS = [
  { href: "#features", label: "Product" },
  { href: "#workflows", label: "Workflows" },
  { href: "#stories", label: "Customers" },
  { href: "#faq", label: "FAQ" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="flex items-center justify-center border-b border-zinc-200 bg-zinc-50 px-4 py-1.5">
        <Link href="#integrations" className="group flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 hover:border-zinc-300">
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">New</span>
          Try our all-new Naukri sync
          <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
      <nav aria-label="Primary" className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="TalentGraph home" className="flex items-center">
          <Logo alwaysShowName />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Link href={APP_HREF} className="hidden h-9 items-center rounded-lg px-3 text-sm text-zinc-700 hover:bg-zinc-100 sm:inline-flex">
            Sign in
          </Link>
          <Link href={APP_HREF} className={btnPrimary}>
            Try for free
          </Link>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-800 md:hidden"
          >
            {open ? <X className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </nav>
      {open && (
        <div className="border-t border-zinc-200 bg-white px-4 py-3 md:hidden">
          <ul className="flex flex-col">
            {[...LINKS, { href: APP_HREF, label: "Sign in" }].map((link) => (
              <li key={link.href}>
                <a href={link.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm text-zinc-800 hover:bg-zinc-50">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
