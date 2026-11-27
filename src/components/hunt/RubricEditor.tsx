"use client";

import { History, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toMessage } from "@/lib/api";
import { hunt, type RubricData, type RubricDimension } from "@/lib/hunt";
import { ChipInput } from "../ChipInput";
import { Badge, Button, Card, inputClass, Notice, Skeleton } from "./ui";

const HELP: Record<string, string> = {
  skills: "Must-have and nice-to-have skills, read from the JD.",
  experience: "Minimum and maximum years of experience.",
  compensation: "Budget in LPA. With no budget, this dimension is not scored. An unknown expectation is missing information, not a fail.",
  availability: "Longest acceptable notice period in days.",
  location: "Cities you can hire in; remote forgives a different city.",
  education: "Accepted degrees. With none listed, this dimension is not scored.",
  career: "Target job titles and industries; also counts demonstrated impact.",
};

/** The seven-dimension rubric of a job: AI-extracted from the JD, editable weights and criteria, versioned, optional re-scoring. */
export function RubricEditor({ jobId, canEdit, onSaved }: { jobId: string; canEdit: boolean; onSaved: () => void }) {
  const [data, setData] = useState<RubricData | null>(null);
  const [version, setVersion] = useState(0);
  const [versions, setVersions] = useState<Array<{ id: string; version: number; notes: string | null; createdAt: string }>>([]);
  const [notes, setNotes] = useState("");
  const [rescore, setRescore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = () => hunt.rubric(jobId).then((r) => { setData(r.rubric); setVersion(r.version); setVersions(r.versions); }).catch((e: unknown) => setError(toMessage(e)));
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const setDim = (key: string, patch: Partial<RubricDimension>) => setData((d) => d && { ...d, dimensions: d.dimensions.map((x) => (x.key === key ? { ...x, ...patch } : x)) });
  const setCfg = (key: string, patch: Record<string, unknown>) => setData((d) => d && { ...d, dimensions: d.dimensions.map((x) => (x.key === key ? { ...x, config: { ...x.config, ...patch } } : x)) });
  const cfg = (key: string) => data?.dimensions.find((d) => d.key === key)?.config ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
  const numVal = (v: unknown) => (typeof v === "number" ? String(v) : "");
  const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

  async function save() {
    if (!data) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const r = await hunt.saveRubric(jobId, data, notes, rescore);
      setOk(`Saved as version ${r.version}.${r.rescored !== null ? ` ${r.rescored} candidates were re-evaluated.` : " Existing scores keep the version that produced them."}`);
      setNotes("");
      await load();
      onSaved();
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <Notice>{error}</Notice> : <Skeleton className="h-64" />;
  const total = data.dimensions.filter((d) => d.enabled).reduce((s, d) => s + d.weight, 0) + data.custom.reduce((s, c) => s + c.weight, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950">Evaluation rubric <Badge tone="indigo">version {version}</Badge></h2>
          <p className="text-sm text-zinc-600">How candidates are judged for this job, separate from Naukri search filters. Weights are relative: they are normalised, so only the proportions matter.</p>
        </div>
      </div>

      <ul className="space-y-3">
        {data.dimensions.map((d) => {
          const share = d.enabled && total > 0 ? Math.round((d.weight / total) * 100) : 0;
          return (
            <li key={d.key}>
              <Card className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                    <input type="checkbox" className="size-4 accent-[#4f46e5]" disabled={!canEdit} checked={d.enabled} onChange={(e) => setDim(d.key, { enabled: e.target.checked })} /> {d.label}
                  </label>
                  <div className="flex items-center gap-2 text-xs text-zinc-600">
                    <label htmlFor={`w-${d.key}`}>Weight</label>
                    <input id={`w-${d.key}`} type="range" min={0} max={100} value={d.weight} disabled={!canEdit || !d.enabled} onChange={(e) => setDim(d.key, { weight: Number(e.target.value) })} className="accent-[#4f46e5]" />
                    <span className="w-8 tabular-nums text-zinc-900">{d.weight}</span>
                    <Badge>{share}% of score</Badge>
                  </div>
                </div>
                <p className="text-xs text-zinc-500">{HELP[d.key]}</p>
                {d.enabled && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {d.key === "skills" && (<>
                      <ChipInput label="Must-have skills" values={list(d.config.mustHave)} onChange={(v) => setCfg("skills", { mustHave: v })} placeholder="Add skill" />
                      <ChipInput label="Nice-to-have skills" values={list(d.config.nice)} onChange={(v) => setCfg("skills", { nice: v })} placeholder="Add skill" />
                    </>)}
                    {d.key === "experience" && (<>
                      <Num label="Minimum years" value={numVal(cfg("experience").minYears)} onChange={(s) => setCfg("experience", { minYears: num(s) })} />
                      <Num label="Maximum years" value={numVal(cfg("experience").maxYears)} onChange={(s) => setCfg("experience", { maxYears: num(s) })} />
                    </>)}
                    {d.key === "compensation" && (<>
                      <Num label="Budget minimum (LPA)" value={numVal(cfg("compensation").minLpa)} onChange={(s) => setCfg("compensation", { minLpa: num(s) })} />
                      <Num label="Budget maximum (LPA)" value={numVal(cfg("compensation").maxLpa)} onChange={(s) => setCfg("compensation", { maxLpa: num(s) })} />
                    </>)}
                    {d.key === "availability" && <Num label="Maximum notice period (days)" value={numVal(cfg("availability").maxNoticeDays)} onChange={(s) => setCfg("availability", { maxNoticeDays: num(s) })} />}
                    {d.key === "location" && (<>
                      <ChipInput label="Locations" values={list(d.config.locations)} onChange={(v) => setCfg("location", { locations: v })} placeholder="Add city" />
                      <label className="flex items-center gap-2 self-end text-sm text-zinc-700"><input type="checkbox" className="accent-[#4f46e5]" disabled={!canEdit} checked={Boolean(d.config.remote)} onChange={(e) => setCfg("location", { remote: e.target.checked })} /> Remote work is allowed</label>
                    </>)}
                    {d.key === "education" && <ChipInput label="Accepted education" values={list(d.config.required)} onChange={(v) => setCfg("education", { required: v })} placeholder="e.g. B.Tech" />}
                    {d.key === "career" && (<>
                      <ChipInput label="Target titles" values={list(d.config.targetTitles)} onChange={(v) => setCfg("career", { targetTitles: v })} placeholder="Add title" />
                      <ChipInput label="Industries (optional)" values={list(d.config.industries)} onChange={(v) => setCfg("career", { industries: v })} placeholder="Add industry" />
                    </>)}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-950">Custom criteria</h3>
          {canEdit && data.custom.length < 10 && <Button size="sm" onClick={() => setData({ ...data, custom: [...data.custom, { name: "", weight: 10, keywords: [] }] })}><Plus className="size-3.5" aria-hidden="true" /> Add criterion</Button>}
        </div>
        {data.custom.length === 0 && <p className="text-sm text-zinc-500">None. Add something the standard seven do not cover, e.g. &quot;On-call experience&quot; with keywords on-call, pager.</p>}
        {data.custom.map((c, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-zinc-200 p-3 sm:grid-cols-[1fr_90px_auto]">
            <input className={inputClass} placeholder="Name" value={c.name} disabled={!canEdit} onChange={(e) => setData({ ...data, custom: data.custom.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label="Criterion name" />
            <input className={inputClass} inputMode="numeric" value={c.weight} disabled={!canEdit} onChange={(e) => setData({ ...data, custom: data.custom.map((x, j) => (j === i ? { ...x, weight: Math.min(100, Number(e.target.value) || 0) } : x)) })} aria-label="Criterion weight" />
            {canEdit && <Button size="sm" variant="danger" onClick={() => setData({ ...data, custom: data.custom.filter((_, j) => j !== i) })} aria-label="Remove criterion"><Trash2 className="size-3.5" aria-hidden="true" /></Button>}
            <div className="sm:col-span-3"><ChipInput label="Evidence keywords" values={c.keywords} onChange={(v) => setData({ ...data, custom: data.custom.map((x, j) => (j === i ? { ...x, keywords: v } : x)) })} placeholder="Add keyword" /></div>
          </div>
        ))}
      </Card>

      {canEdit && (
        <Card className="space-y-3 p-4">
          <input className={inputClass} placeholder="What changed? (optional note for the history)" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Version note" />
          <label className="flex items-start gap-2 text-sm text-zinc-700"><input type="checkbox" className="mt-0.5 accent-[#4f46e5]" checked={rescore} onChange={(e) => setRescore(e.target.checked)} /> Re-evaluate this job&apos;s existing candidates with the new version. Evaluations made under older versions stay in each candidate&apos;s history.</label>
          {error && <Notice>{error}</Notice>}
          {ok && <Notice tone="green">{ok}</Notice>}
          <Button variant="primary" onClick={() => void save()} loading={busy}>Save as version {version + 1}</Button>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-950"><History className="size-4" aria-hidden="true" /> Version history</h3>
        <ul className="space-y-1 text-sm">
          {versions.map((v) => <li key={v.id} className="flex justify-between"><span>Version {v.version}{v.notes ? `: ${v.notes}` : ""}</span><span className="tabular-nums text-zinc-500">{new Date(v.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span></li>)}
        </ul>
      </Card>
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (s: string) => void }) {
  return (
    <label className="block text-xs font-medium text-zinc-700">
      {label}
      <input className={`${inputClass} mt-1`} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
