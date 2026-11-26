"use client";

import { ArrowRight, Check, Copy, Mail, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { APP_HREF, DEMO_CANDIDATES, DEMO_HREF, SOURCE_LABEL, STANDARD_WEIGHTS, type SourceId } from "./data";
import { rankCandidates } from "./demoSearch";
import { Avatar, ScoreChip, SectionHeader, SourceBadge, btnPrimary, btnSecondary } from "./ui";

type TabId = "align" | "search" | "engage";

const TABS: Array<{ id: TabId; label: string; title: string; body: string; points: string[] }> = [
  {
    id: "align",
    label: "Align",
    title: "Start from the job description, not a keyword guess",
    body: "Paste a JD and TalentGraph extracts the must-have and nice-to-have skills, experience and locations. You confirm them once, and every source is searched against the same spec.",
    points: ["Skills split into must-have and nice-to-have", "Standard weighting, identical for every recruiter", "Edit the spec at any time and re-rank instantly"],
  },
  {
    id: "search",
    label: "Search",
    title: "One ranked list across every source",
    body: "Naukri, LinkedIn, Cutshort and GitHub candidates are de-duplicated and scored on the same scale. Filter by source, and spend CV views only on the people worth opening.",
    points: ["Each person appears once, with one score", "Matched and missing skills shown on every card", "Resume stored the moment you shortlist"],
  },
  {
    id: "engage",
    label: "Engage",
    title: "Reach out with the context already in hand",
    body: "Shortlisted candidates carry their phone, notice period, CTC and resume. Draft a personalised first message in one click and copy it into email or WhatsApp.",
    points: ["Notice period and CTC on the card", "Message drafted from the candidate's own profile", "Resume one click away, never a dead link"],
  },
];

const JD_SKILLS = ["Kubernetes", "Go", "AWS", "Terraform", "Linux", "Observability", "Python", "Jenkins"];

function AlignPreview() {
  const [must, setMust] = useState<Set<string>>(new Set(["Kubernetes", "Go", "AWS"]));
  const toggle = (skill: string) =>
    setMust((current) => {
      const next = new Set(current);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  const nice = JD_SKILLS.filter((skill) => !must.has(skill));
  return (
    <div>
      <p className="section-tag mb-1">job description</p>
      <p className="text-sm font-medium text-zinc-950">Senior Site Reliability Engineer · Hyderabad · 5+ years</p>
      <p className="mt-2 rounded-lg bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-600">
        Own reliability for a multi-region platform. Strong Go and Kubernetes on AWS, infrastructure as code with Terraform, and a track record of building observability that engineers actually use.
      </p>
      <p className="mt-4 text-xs text-zinc-500">Click a skill to move it between must-have and nice-to-have.</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {[
          { title: "Must-have", skills: JD_SKILLS.filter((skill) => must.has(skill)) },
          { title: "Nice-to-have", skills: nice },
        ].map((group) => (
          <div key={group.title} className="min-h-24 rounded-lg border border-zinc-200 p-3">
            <p className="mb-2 flex items-center justify-between text-xs font-medium text-zinc-800">
              {group.title} <span className="tabular-nums text-zinc-500">{group.skills.length}</span>
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {group.skills.map((skill) => (
                <li key={skill}>
                  <button type="button" onClick={() => toggle(skill)} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-800 hover:border-accent hover:text-accent">
                    {skill}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
        <span className="font-mono tracking-wider">WEIGHTS</span>
        <span className="tabular-nums">Skills {STANDARD_WEIGHTS.skills} · Experience {STANDARD_WEIGHTS.experience} · Impact {STANDARD_WEIGHTS.impact} · Industry {STANDARD_WEIGHTS.industry}</span>
      </div>
    </div>
  );
}

const ALL: SourceId[] = ["naukri", "linkedin", "cutshort", "github"];

function SearchPreview() {
  const [sources, setSources] = useState<Set<SourceId>>(new Set(ALL));
  const { ranked } = useMemo(() => rankCandidates("kubernetes go aws terraform hyderabad bengaluru 5+ years", sources), [sources]);
  const toggle = (source: SourceId) =>
    setSources((current) => {
      const next = new Set(current);
      if (next.has(source)) {
        if (next.size > 1) next.delete(source);
      } else next.add(source);
      return next;
    });
  return (
    <div>
      <div role="group" aria-label="Sources" className="mb-3 flex flex-wrap gap-1.5">
        {ALL.map((source) => (
          <button
            key={source}
            type="button"
            aria-pressed={sources.has(source)}
            onClick={() => toggle(source)}
            className={`h-8 rounded-lg border px-3 text-xs transition-colors ${sources.has(source) ? "border-accent bg-accent/5 font-medium text-accent" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}
          >
            {SOURCE_LABEL[source]}
          </button>
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {ranked.slice(0, 5).map(({ candidate, score, matched }, index) => (
          <li key={candidate.id} className="flex items-center gap-3 rounded-lg border border-zinc-200 p-2.5">
            <span className="w-4 text-center text-xs tabular-nums text-zinc-400">{index + 1}</span>
            <Avatar name={candidate.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-950">{candidate.name}</p>
              <p className="truncate text-xs text-zinc-600">
                {candidate.title} · {matched.length} skills matched
              </p>
            </div>
            <SourceBadge source={candidate.source} />
            <ScoreChip score={score} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const ENGAGE = DEMO_CANDIDATES.filter((candidate) => ["c2", "c1", "c8"].includes(candidate.id));

function EngagePreview() {
  const [id, setId] = useState(ENGAGE[0]!.id);
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [copied, setCopied] = useState(false);
  const person = ENGAGE.find((candidate) => candidate.id === id) ?? ENGAGE[0]!;
  const first = person.name.split(" ")[0];
  const message =
    channel === "email"
      ? `Hi ${first},\n\nYour work on ${person.skills.slice(0, 2).join(" and ")} at ${person.company} stood out. We have a Senior SRE role in Hyderabad building a multi-region platform on Kubernetes and Go.\n\nWith your ${person.notice} notice, we could keep the process quick. Open to a 20 minute call this week?`
      : `Hi ${first}, this is the TalentGraph recruiting team. Your ${person.skills[0]} experience at ${person.company} is a strong fit for a Senior SRE role in Hyderabad. Free for a quick call this week?`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      /* clipboard can be blocked: the label still confirms the click */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div>
      <div role="group" aria-label="Shortlisted candidates" className="mb-3 flex flex-wrap gap-1.5">
        {ENGAGE.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            aria-pressed={id === candidate.id}
            onClick={() => setId(candidate.id)}
            className={`flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs ${id === candidate.id ? "border-accent bg-accent/5 text-accent" : "border-zinc-200 text-zinc-700 hover:bg-zinc-50"}`}
          >
            <Avatar name={candidate.name} size={22} />
            {candidate.name}
          </button>
        ))}
      </div>
      <dl className="mb-3 grid grid-cols-3 gap-2 text-xs">
        {[
          ["Notice", person.notice],
          ["Experience", `${person.years} yrs`],
          ["Location", person.city],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-zinc-50 px-3 py-2">
            <dt className="text-zinc-500">{label}</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-zinc-950">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mb-2 flex items-center justify-between">
        <div role="group" aria-label="Channel" className="inline-flex rounded-lg border border-zinc-200 p-0.5">
          {(["email", "whatsapp"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={channel === value} onClick={() => setChannel(value)} className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-xs ${channel === value ? "bg-zinc-950 text-white" : "text-zinc-600"}`}>
              {value === "email" ? <Mail className="size-3" aria-hidden="true" /> : <MessageCircle className="size-3" aria-hidden="true" />}
              {value === "email" ? "Email" : "WhatsApp"}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void copy()} className="flex h-7 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 text-xs text-zinc-800 hover:bg-zinc-50">
          {copied ? <Check className="size-3 text-tier-high" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="min-h-36 whitespace-pre-line rounded-lg border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-800">{message}</p>
    </div>
  );
}

export function Features() {
  const [tab, setTab] = useState<TabId>("align");
  const active = TABS.find((item) => item.id === tab) ?? TABS[0]!;
  return (
    <section id="features" className="border-b border-zinc-200 bg-zinc-50 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader tag="[01] features" title="From job description to shortlist, in one place" />
        <div role="tablist" aria-label="Features" className="mx-auto mt-8 flex w-fit rounded-full border border-zinc-200 bg-white p-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls="feature-panel"
              type="button"
              onClick={() => setTab(item.id)}
              className={`h-8 rounded-full px-5 text-sm transition-colors ${tab === item.id ? "bg-accent font-medium text-white" : "text-zinc-600 hover:text-zinc-950"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div id="feature-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-10 grid items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
          <div key={`copy-${tab}`} className="fade-up">
            <h3 className="text-2xl font-semibold text-zinc-950 sm:text-3xl">{active.title}</h3>
            <p className="mt-3 text-base text-zinc-600">{active.body}</p>
            <ul className="mt-5 flex flex-col gap-2">
              {active.points.map((point) => (
                <li key={point} className="flex items-start gap-2 text-sm text-zinc-800">
                  <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-2">
              <Link href={APP_HREF} className={btnPrimary}>
                Try for free
              </Link>
              <a href={DEMO_HREF} className={btnSecondary}>
                Book a demo <ArrowRight className="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
          <div key={`card-${tab}`} className="fade-up rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_8px_30px_rgb(9_9_11/0.05)] sm:p-5">
            {tab === "align" && <AlignPreview />}
            {tab === "search" && <SearchPreview />}
            {tab === "engage" && <EngagePreview />}
          </div>
        </div>
      </div>
    </section>
  );
}
