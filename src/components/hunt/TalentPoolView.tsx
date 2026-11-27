"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toMessage } from "@/lib/api";
import { hunt, SOURCE_LABEL, STAGE_LABEL } from "@/lib/hunt";
import { Avatar, Badge, Card, Empty, inputClass, Notice, PageHeader, Skeleton, SourceBadge, TierBadge } from "./ui";

/** Every person in the organization, once, with every job they were considered for. Deduplicated across sources. */
export function TalentPoolView({ initialTier }: { initialTier: string | null }) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof hunt.talentPool>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { setData(null); hunt.talentPool({ q, source }).then(setData).catch((e: unknown) => setError(toMessage(e))); }, 250);
    return () => clearTimeout(t);
  }, [q, source]);
  const rows = (data?.candidates ?? []).filter((c) => !initialTier || c.jobs.some((j) => j.tier === initialTier));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Talent Pool" subtitle={initialTier ? `Candidates with a ${initialTier.replace("_", " ")} match on at least one job.` : "Everyone you have sourced, across all jobs and platforms. Each person appears once."} />
      <div className="flex flex-wrap gap-2">
        <input className={`${inputClass} max-w-sm`} placeholder="Search name, role, skill, city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the talent pool" />
        <select className={`${inputClass} w-44`} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Platform"><option value="">All platforms</option>{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {data && <span className="self-center text-xs tabular-nums text-zinc-500">{rows.length} of {data.total}</span>}
      </div>
      {error && <Notice>{error}</Notice>}
      {!data && !error && <Skeleton className="h-64" />}
      {data && rows.length === 0 && <Empty title="No candidates found">Source candidates from a job, or change the search.</Empty>}
      <ul className="grid gap-3">
        {rows.map((c) => (
          <li key={c.id}>
            <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
              <Avatar name={c.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-zinc-950">{c.name}</h2>{c.sources.map((s) => <SourceBadge key={s} source={s} />)}{c.hasResume && <Badge tone="green">Resume saved</Badge>}</div>
                <p className="text-sm text-zinc-700">{c.headline}</p>
                <p className="text-xs text-zinc-500">{[c.location, c.experienceYears !== null ? `${c.experienceYears} yrs` : null].filter(Boolean).join(" · ")}</p>
                {c.skills.length > 0 && <p className="mt-1 text-xs text-zinc-600">{c.skills.join(" · ")}</p>}
              </div>
              <ul className="flex flex-col gap-1 sm:items-end">
                {c.jobs.map((j) => <li key={j.matchId}><Link href={`/jobs/${j.jobId}`} className="flex items-center gap-1.5 text-xs text-zinc-700 hover:text-accent"><span className="max-w-48 truncate">{j.jobTitle}</span><span className="tabular-nums font-semibold">{j.score ?? "n/a"}</span><TierBadge tier={j.tier} /><Badge>{STAGE_LABEL[j.stage as keyof typeof STAGE_LABEL] ?? j.stage}</Badge></Link></li>)}
              </ul>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
