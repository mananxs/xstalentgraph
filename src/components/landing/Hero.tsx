"use client";

import { ArrowRight, Bot, Check, CornerDownLeft, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_STEPS, APP_HREF, DEMO_HREF, SAMPLE_PROMPTS, SOURCE_LABEL, STANDARD_WEIGHTS, type SourceId } from "./data";
import { rankCandidates } from "./demoSearch";
import { Avatar, ScoreChip, SourceBadge, btnPrimary, btnSecondary } from "./ui";

const PROOF = [
  { value: "4", label: "sources ranked as one list" },
  { value: "1 click", label: "to shortlist and store the resume" },
  { value: "Top 10", label: "profiles surfaced per job description" },
];

type Mode = "search" | "agent";
const ALL_SOURCES: SourceId[] = ["naukri", "linkedin", "cutshort", "github"];

export function Hero() {
  const [mode, setMode] = useState<Mode>("search");
  const [prompt, setPrompt] = useState(SAMPLE_PROMPTS[0] ?? "");
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [step, setStep] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { parsed, ranked } = useMemo(() => rankCandidates(prompt, new Set(ALL_SOURCES)), [prompt]);
  const top = ranked.slice(0, 5);
  const showResults = mode === "search" ? prompt.trim().length > 0 : phase === "done";

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  function runAgent() {
    if (!prompt.trim()) return;
    stop();
    setPhase("running");
    setStep(0);
    timer.current = setInterval(() => {
      setStep((current) => {
        if (current + 1 >= AGENT_STEPS.length) {
          stop();
          setPhase("done");
          return current;
        }
        return current + 1;
      });
    }, 650);
  }

  function chooseMode(next: Mode) {
    stop();
    setMode(next);
    setPhase("idle");
    setStep(0);
  }

  function pickPrompt(text: string) {
    setPrompt(text);
    inputRef.current?.focus();
    if (mode === "agent") {
      stop();
      setPhase("idle");
    }
  }

  return (
    <section aria-labelledby="hero-title" className="border-b border-zinc-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 id="hero-title" className="text-4xl font-semibold leading-[1.05] text-zinc-950 sm:text-6xl">
            Hire your best candidate faster
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-zinc-600 sm:text-lg">
            Turn any job description into a ranked shortlist from Naukri, LinkedIn, Cutshort and GitHub. Every resume is stored in one place, so nothing expires or goes missing.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Link href={APP_HREF} className={`${btnPrimary} w-full sm:w-auto`}>
              Try for free
            </Link>
            <a href={DEMO_HREF} className={`${btnSecondary} w-full sm:w-auto`}>
              Book a demo
            </a>
          </div>
        </div>

        <dl className="mx-auto mt-12 grid max-w-3xl grid-cols-1 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-zinc-50 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {PROOF.map((item) => (
            <div key={item.label} className="px-5 py-4 text-center">
              <dt className="sr-only">{item.label}</dt>
              <dd>
                <span className="block text-2xl font-semibold tabular-nums text-zinc-950">{item.value}</span>
                <span className="mt-0.5 block text-xs text-zinc-600">{item.label}</span>
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-14 text-center font-mono text-xs tracking-wider text-zinc-500">TRY IT OUT, OR SCROLL DOWN</p>

        {/* ---------- interactive sandbox ---------- */}
        <div id="sandbox" className="mx-auto mt-4 max-w-4xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_8px_30px_rgb(9_9_11/0.06)]">
          <div className="flex flex-col gap-3 border-b border-zinc-200 bg-zinc-50 p-3 sm:flex-row sm:items-center">
            <div role="group" aria-label="Mode" className="inline-flex shrink-0 rounded-lg border border-zinc-200 bg-white p-0.5">
              {(["search", "agent"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={mode === id}
                  onClick={() => chooseMode(id)}
                  className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${mode === id ? "bg-accent font-medium text-white" : "text-zinc-600 hover:text-zinc-950"}`}
                >
                  {id === "search" ? <Search className="size-3.5" aria-hidden="true" /> : <Bot className="size-3.5" aria-hidden="true" />}
                  {id === "search" ? "Search" : "Agent"}
                </button>
              ))}
            </div>
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (mode === "agent") runAgent();
              }}
            >
              <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                <span className="sr-only">Describe the role</span>
                <input
                  ref={inputRef}
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    if (mode === "agent" && phase !== "idle") {
                      stop();
                      setPhase("idle");
                    }
                  }}
                  placeholder="Describe the role: skills, city, years of experience"
                  className="min-w-0 flex-1 bg-transparent text-sm text-zinc-950 outline-none placeholder:text-zinc-400"
                />
                <CornerDownLeft className="hidden size-3.5 shrink-0 text-zinc-400 sm:block" aria-hidden="true" />
              </label>
              {mode === "agent" && (
                <button type="submit" disabled={phase === "running" || !prompt.trim()} className={`${btnPrimary} shrink-0 disabled:opacity-60`}>
                  {phase === "running" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Bot className="size-3.5" aria-hidden="true" />}
                  {phase === "running" ? "Running" : "Run agent"}
                </button>
              )}
            </form>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-200 px-3 py-2.5">
            <span className="mr-1 font-mono text-[11px] tracking-wider text-zinc-500">TRY</span>
            {SAMPLE_PROMPTS.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => pickPrompt(text)}
                className={`max-w-full truncate rounded-full border px-2.5 py-1 text-xs transition-colors ${prompt === text ? "border-accent bg-accent/5 text-accent" : "border-zinc-200 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"}`}
              >
                {text}
              </button>
            ))}
          </div>

          <div className="min-h-72 p-3 sm:p-4" aria-live="polite">
            {mode === "agent" && phase === "idle" && (
              <p className="flex h-60 items-center justify-center text-center text-sm text-zinc-500">Press Run agent and it will work through the requirement step by step.</p>
            )}

            {mode === "agent" && phase !== "idle" && (
              <ol className="mb-4 grid gap-1.5 sm:grid-cols-2">
                {AGENT_STEPS.map((label, index) => {
                  const done = phase === "done" || index < step;
                  const active = phase === "running" && index === step;
                  return (
                    <li key={label} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${done ? "border-zinc-200 bg-white text-zinc-800" : active ? "border-accent/40 bg-accent/5 text-zinc-950" : "border-zinc-100 text-zinc-400"}`}>
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                        {done ? <Check className="size-3.5 text-tier-high" aria-hidden="true" /> : active ? <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden="true" /> : <span className="size-1.5 rounded-full bg-zinc-300" />}
                      </span>
                      {label}
                    </li>
                  );
                })}
              </ol>
            )}

            {showResults && (
              <>
                {parsed.skills.length === 0 ? (
                  <p className="flex h-52 items-center justify-center px-4 text-center text-sm text-zinc-500">Name a few skills so the ranking has something to work with, for example Kubernetes, Python or React.</p>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-zinc-600">
                      <span className="tabular-nums">
                        Top {top.length} of {ranked.length} ranked
                        {parsed.years ? ` · ${parsed.years}+ yrs` : ""}
                        {parsed.cities.length ? ` · ${parsed.cities.map((city) => city.charAt(0).toUpperCase() + city.slice(1)).join(", ")}` : ""}
                      </span>
                      <span className="font-mono text-[11px] tracking-wider text-zinc-500">SKILLS {STANDARD_WEIGHTS.skills} · EXPERIENCE {STANDARD_WEIGHTS.experience} · LOCATION {STANDARD_WEIGHTS.location}</span>
                    </div>
                    <ul className="flex flex-col gap-2">
                      {top.map(({ candidate, score, matched, missing }, index) => (
                        <li key={candidate.id} className="fade-up flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3">
                          <span className="mt-1.5 w-4 shrink-0 text-center text-xs tabular-nums text-zinc-400">{index + 1}</span>
                          <Avatar name={candidate.name} size={36} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <p className="truncate text-sm font-medium text-zinc-950">{candidate.name}</p>
                              <SourceBadge source={candidate.source} />
                            </div>
                            <p className="truncate text-xs text-zinc-600">
                              {candidate.title} at {candidate.company}
                            </p>
                            <p className="text-xs tabular-nums text-zinc-500">
                              {candidate.city} · {candidate.years} yrs · {candidate.notice} notice
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-1">
                              {matched.slice(0, 4).map((skill) => (
                                <span key={skill} className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-tier-high">
                                  <Check className="size-2.5" aria-hidden="true" />
                                  {skill}
                                </span>
                              ))}
                              {missing.slice(0, 2).map((skill) => (
                                <span key={skill} className="rounded-full border border-dashed border-rose-300 px-2 py-0.5 text-[11px] text-tier-low">
                                  missing {skill}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <ScoreChip score={score} />
                            <span className="hidden items-center gap-1 text-[11px] text-zinc-500 sm:flex">
                              <Check className="size-3 text-tier-high" aria-hidden="true" /> Resume stored
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex items-center justify-between gap-3 px-1">
                      <p className="text-xs text-zinc-500">Demo data. Sources: {ALL_SOURCES.map((source) => SOURCE_LABEL[source]).join(", ")}.</p>
                      <Link href={APP_HREF} className="flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-strong">
                        Run this on your own jobs <ArrowRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
