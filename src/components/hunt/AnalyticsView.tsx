"use client";

import { useEffect, useState } from "react";
import { useJobs } from "@/hooks/useJobs";
import { toMessage } from "@/lib/api";
import { hunt, SOURCE_LABEL, STAGE_LABEL, TIER_LABEL, type Analytics } from "@/lib/hunt";
import { Card, Empty, inputClass, Notice, PageHeader, Skeleton } from "./ui";

function Bars({ items, tone = "bg-accent" }: { items: Array<{ label: string; value: number }>; tone?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[130px_1fr_40px] items-center gap-2 text-sm">
          <span className="truncate text-zinc-700">{i.label}</span>
          <span className="h-2 rounded-full bg-zinc-100"><span className={`block h-2 rounded-full ${tone}`} style={{ width: `${(i.value / max) * 100}%` }} /></span>
          <span className="text-right tabular-nums text-zinc-900">{i.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Real analytics from the pipeline tables. Nothing is estimated: empty data shows zeros, not invented numbers. */
export function AnalyticsView() {
  const { jobs } = useJobs();
  const [f, setF] = useState({ from: "", to: "", jobId: "", source: "" });
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    hunt.analytics(f).then(setData).catch((e: unknown) => setError(toMessage(e)));
  }, [f]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Reports & Analytics" subtitle="Counted from your pipeline. Filter by date, job and platform." />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-zinc-700">From<input type="date" className={`${inputClass} mt-1 w-40`} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="text-xs font-medium text-zinc-700">To<input type="date" className={`${inputClass} mt-1 w-40`} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label className="text-xs font-medium text-zinc-700">Job<select className={`${inputClass} mt-1 w-56`} value={f.jobId} onChange={(e) => setF({ ...f, jobId: e.target.value })}><option value="">All jobs</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</select></label>
        <label className="text-xs font-medium text-zinc-700">Platform<select className={`${inputClass} mt-1 w-40`} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">All platforms</option>{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      {error && <Notice>{error}</Notice>}
      {!data && !error && <Skeleton className="h-64" />}
      {data && data.totalSourced === 0 && <Empty title="No candidates in this selection">Change the filters, or source some candidates first. Nothing is shown until there is real data.</Empty>}
      {data && data.totalSourced > 0 && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Totals">
            {[["Total sourced", data.totalSourced], ["Shortlisted", data.shortlisted], ["Awaiting review", data.awaitingReview], ["Hired", data.stageCounts.hired ?? 0]].map(([l, v]) => (
              <Card key={l as string} className="p-4"><p className="text-xs text-zinc-600">{l}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-950">{v}</p></Card>
            ))}
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4"><h2 className="mb-3 text-sm font-semibold text-zinc-950">Candidates by platform</h2><Bars items={Object.entries(data.byPlatform).map(([k, v]) => ({ label: SOURCE_LABEL[k] ?? k, value: v }))} /></Card>
            <Card className="p-4"><h2 className="mb-3 text-sm font-semibold text-zinc-950">Candidate quality</h2><Bars tone="bg-emerald-500" items={Object.entries(data.quality).filter(([, v]) => v > 0).map(([k, v]) => ({ label: TIER_LABEL[k as keyof typeof TIER_LABEL] ?? "Not evaluated", value: v }))} /></Card>
            <Card className="p-4"><h2 className="mb-3 text-sm font-semibold text-zinc-950">Hiring funnel (reached stage)</h2><Bars items={data.funnel.map((x) => ({ label: STAGE_LABEL[x.stage as keyof typeof STAGE_LABEL] ?? x.stage, value: x.count }))} /></Card>
            <Card className="p-4"><h2 className="mb-3 text-sm font-semibold text-zinc-950">Stage counts now</h2><Bars tone="bg-indigo-400" items={Object.entries(data.stageCounts).map(([k, v]) => ({ label: STAGE_LABEL[k as keyof typeof STAGE_LABEL] ?? k, value: v }))} /></Card>
          </div>
          <Card className="overflow-x-auto p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-950">Source-wise conversion</h2>
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-zinc-600"><tr><th className="pb-2">Platform</th><th>Sourced</th><th>Shortlisted</th><th>Interviewed</th><th>Offer</th><th>Hired</th><th>Shortlist rate</th><th>Hire rate</th></tr></thead>
              <tbody className="tabular-nums">{data.conversion.map((c) => <tr key={c.source} className="border-t border-zinc-100"><td className="py-1.5 font-medium">{SOURCE_LABEL[c.source] ?? c.source}</td><td>{c.sourced}</td><td>{c.shortlisted}</td><td>{c.interviewed}</td><td>{c.offer}</td><td>{c.hired}</td><td>{c.shortlistRate}%</td><td>{c.hireRate}%</td></tr>)}</tbody>
            </table>
          </Card>
          <Card className="p-4">
            <h2 className="mb-1 text-sm font-semibold text-zinc-950">Average time in stage (days)</h2>
            <p className="mb-3 text-xs text-zinc-500">Only stages candidates have actually left are measured.</p>
            {Object.keys(data.avgDaysInStage).length === 0 ? <p className="text-sm text-zinc-500">No stage changes recorded yet.</p> : <Bars tone="bg-amber-400" items={Object.entries(data.avgDaysInStage).map(([k, v]) => ({ label: STAGE_LABEL[k as keyof typeof STAGE_LABEL] ?? k, value: v }))} />}
          </Card>
        </>
      )}
    </div>
  );
}
