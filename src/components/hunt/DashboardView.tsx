"use client";

import { Bookmark, Clock, Star, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useJobs } from "@/hooks/useJobs";
import { toMessage } from "@/lib/api";
import { hunt, type ConnectionView } from "@/lib/hunt";
import { Badge, Card, Empty, Notice, PageHeader, Skeleton } from "./ui";

type Metrics = Awaited<ReturnType<typeof hunt.dashboard>>;

/** Four clickable numbers counted from the database, plus where each job stands. */
export function DashboardView() {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnectionView | null>(null);
  const { jobs } = useJobs();
  useEffect(() => {
    hunt.dashboard().then(setM).catch((e: unknown) => setError(toMessage(e)));
    hunt.connection().then(setConn).catch(() => {});
  }, []);
  const cards = m && [
    { label: "Total Candidates", value: m.totalCandidates, href: "/talent-pool", icon: Users, hint: "Different people across every job and source" },
    { label: "Shortlisted", value: m.shortlisted, href: "/shortlists", icon: Bookmark, hint: "Shortlisted and later stages, up to Hired" },
    { label: "Pending Review", value: m.pendingReview, href: "/pipeline?pending=1", icon: Clock, hint: "Still New, Sourced or in Screening" },
    { label: "Strong Matches", value: m.strongMatches, href: "/talent-pool?tier=strong", icon: Star, hint: "Strong Match under their job's rubric" },
  ];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Dashboard" subtitle="Where your hiring stands right now." />
      {error && <Notice>{error}</Notice>}
      <section aria-label="Key numbers" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {!cards && !error && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        {cards?.map((c) => (
          <Link key={c.label} href={c.href} className="group rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-accent hover:shadow-md">
            <div className="flex items-center justify-between text-sm text-zinc-600"><span>{c.label}</span><c.icon className="size-4 text-accent" aria-hidden="true" /></div>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-zinc-950">{c.value}</p>
            <p className="mt-1 text-xs text-zinc-500 group-hover:text-zinc-700">{c.hint}</p>
          </Link>
        ))}
      </section>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950">Naukri extension</h2>
          <p className="text-sm text-zinc-600">{conn === null ? "Checking…" : conn.connected ? `Connected. Naukri session: ${conn.naukri.replace("_", " ")}.` : conn.state === "never" ? "No extension has connected to your account yet." : "Not connected right now."}</p>
        </div>
        <Badge tone={conn?.connected ? "green" : "neutral"}>{conn?.connected ? "Connected" : "Offline"}</Badge>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-950">Jobs</h2>
        {jobs.length === 0 ? <Empty title="No jobs yet">Create a job from a job description to start sourcing.</Empty> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {jobs.map((j) => (
              <li key={j.id}><Link href={`/jobs/${j.id}`} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-accent"><span className="font-medium text-zinc-950">{j.title}</span><Badge>{j.matchCount} candidates</Badge></Link></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
