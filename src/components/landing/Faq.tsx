"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { APP_HREF, DEMO_HREF, FAQS } from "./data";
import { btnPrimary, btnSecondary } from "./ui";

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="border-b border-zinc-200 bg-white py-20">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <p className="section-tag">[06] faq</p>
          <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">Questions, answered</h2>
          <p className="mt-3 text-base text-zinc-600">How sourcing, scoring and resume storage work. Cannot find your answer? Talk to us.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={APP_HREF} className={btnPrimary}>
              Try for free
            </Link>
            <a href={DEMO_HREF} className={btnSecondary}>
              Book a demo
            </a>
          </div>
        </div>
        <ul className="divide-y divide-zinc-200 border-y border-zinc-200">
          {FAQS.map((item, index) => {
            const expanded = open === index;
            return (
              <li key={item.q}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`faq-${index}`}
                    id={`faq-btn-${index}`}
                    onClick={() => setOpen(expanded ? null : index)}
                    className="flex w-full items-center justify-between gap-4 py-4 text-left text-base font-medium text-zinc-950 hover:text-accent"
                  >
                    {item.q}
                    <ChevronDown className={`size-4 shrink-0 text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                </h3>
                <div id={`faq-${index}`} role="region" aria-labelledby={`faq-btn-${index}`} hidden={!expanded} className="pb-5 pr-8 text-sm leading-relaxed text-zinc-600">
                  {item.a}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
