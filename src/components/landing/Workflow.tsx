"use client";

import { Check, Lock, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { STANDARD_WEIGHTS } from "./data";
import { SectionHeader } from "./ui";

function ContextCard() {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs">
      <p className="font-mono text-[10px] tracking-wider text-zinc-500">JOB DESCRIPTION</p>
      <div className="mt-2 space-y-1.5" aria-hidden="true">
        <div className="h-1.5 w-full rounded bg-zinc-200" />
        <div className="h-1.5 w-11/12 rounded bg-zinc-200" />
        <div className="h-1.5 w-3/4 rounded bg-zinc-200" />
      </div>
      <p className="mt-3 font-mono text-[10px] tracking-wider text-zinc-500">EXTRACTED</p>
      <ul className="mt-1.5 flex flex-wrap gap-1">
        {["Kubernetes", "Go", "AWS", "5+ yrs", "Hyderabad"].map((chip) => (
          <li key={chip} className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-zinc-800">
            {chip}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CalibrationCard() {
  const rows = [
    ["Skills", STANDARD_WEIGHTS.skills],
    ["Experience", STANDARD_WEIGHTS.experience],
    ["Impact", STANDARD_WEIGHTS.impact],
    ["Industry", STANDARD_WEIGHTS.industry],
  ] as const;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs">
      <p className="flex items-center justify-between font-mono text-[10px] tracking-wider text-zinc-500">
        STANDARD WEIGHTS
        <span className="inline-flex items-center gap-1 normal-case tracking-normal text-zinc-600">
          <Lock className="size-3" aria-hidden="true" /> Locked for all recruiters
        </span>
      </p>
      <ul className="mt-3 space-y-2.5">
        {rows.map(([label, weight]) => (
          <li key={label}>
            <div className="mb-1 flex justify-between text-zinc-800">
              {label}
              <span className="tabular-nums">{weight}</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-100">
              <div className="h-full rounded-full bg-zinc-950" style={{ width: `${weight}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExecutionCard() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setDone((value) => (value >= 24 ? 24 : value + 1)), 220);
    return () => clearInterval(timer);
  }, [running]);
  const finished = done >= 24;
  useEffect(() => {
    if (finished) setRunning(false);
  }, [finished]);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] tracking-wider text-zinc-500">SCORING</p>
        <button
          type="button"
          aria-pressed={running}
          onClick={() => {
            if (finished) setDone(0);
            setRunning((value) => !value);
          }}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-white transition-colors ${running ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}`}
        >
          {running ? <Square className="size-3 fill-current" aria-hidden="true" /> : <Play className="size-3 fill-current" aria-hidden="true" />}
          {running ? "Scoring: stop" : finished ? "Run again" : "Stopped: start"}
        </button>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-zinc-100" role="progressbar" aria-valuemin={0} aria-valuemax={24} aria-valuenow={done} aria-label="Profiles scored">
        <div className="h-full rounded-full bg-zinc-950 transition-all" style={{ width: `${(done / 24) * 100}%` }} />
      </div>
      <p className="mt-2 flex items-center justify-between text-zinc-600">
        <span className="tabular-nums">{done} of 24 profiles scored</span>
        {finished && (
          <span className="inline-flex items-center gap-1 text-tier-high">
            <Check className="size-3" aria-hidden="true" /> Top 10 ready
          </span>
        )}
      </p>
    </div>
  );
}

const STEPS = [
  { n: "01", title: "Context", body: "Paste the job description. Skills, experience and locations are extracted for you to confirm.", card: <ContextCard /> },
  { n: "02", title: "Calibration", body: "One standard weighting is applied to every job, so scores mean the same thing for everyone.", card: <CalibrationCard /> },
  { n: "03", title: "Execution", body: "Start scoring when you are ready and stop whenever you like. Only the best profiles are opened.", card: <ExecutionCard /> },
];

export function Workflow() {
  return (
    <section id="workflows" className="border-b border-zinc-200 bg-white py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader tag="[02] intelligent workflows" title="A repeatable three-step process">
          The same steps for every requirement, so results are predictable and easy to review.
        </SectionHeader>
        <ol className="mt-12 grid overflow-hidden rounded-2xl border border-zinc-200 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.n} className={`flex flex-col gap-4 bg-white p-6 ${index > 0 ? "border-t border-zinc-200 md:border-l md:border-t-0" : ""}`}>
              <p className="section-tag">{`[${step.n}]`}</p>
              <h3 className="-mt-2 text-xl font-semibold text-zinc-950">{step.title}</h3>
              <p className="text-sm text-zinc-600">{step.body}</p>
              <div className="mt-auto rounded-xl bg-zinc-50 p-3">{step.card}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
