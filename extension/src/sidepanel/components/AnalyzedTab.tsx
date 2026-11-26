import { useCallback, useEffect, useMemo, useState } from "react";
import { K, type AnalyzedItem, type AnalyzedList, type RankEntry, type SearchSessionInfo, type SearchSnapshot } from "../../shared/types";
import { call, scoreColor, useStorage } from "../lib";
import { Pill } from "../Pill";

type Scope = "search" | "job";
type Loaded = AnalyzedList & { scope: Scope; session: SearchSessionInfo | null };

/**
 * "Already analyzed": every candidate you've scored for this job (or only the ones found in the CURRENT Naukri search),
 * read straight from your score cache. Nothing here calls the AI — new cards are scored in Live Ranking.
 */
export default function AnalyzedTab({ tabId, onResdex, jobId }: { tabId: number | null; onResdex: boolean; jobId?: string }) {
  const snap = useStorage<SearchSnapshot>("session", tabId === null ? null : K.search(tabId));
  const entries = useStorage<RankEntry[]>("session", tabId === null ? null : K.rank(tabId)) ?? [];
  const [scope, setScope] = useState<Scope>(onResdex ? "search" : "job");
  const [minScore, setMinScore] = useState(0);
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  // reload when the job, scope, filter, the Naukri search, or the number of scored cards changes (new scores land in the cache)
  const doneCount = entries.filter((e) => e.state === "done" && !e.result?.cached).length;
  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError("");
    try {
      setData(await call<Loaded>({ type: "GET_ANALYZED", tabId, scope, minScore }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [jobId, tabId, scope, minScore]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load, snap?.appliedSig, doneCount]);

  const onPage = useMemo(() => new Map(entries.filter((e) => e.result?.key).map((e) => [e.result!.key!, e])), [entries]);
  const items = (data?.items ?? []).filter((i) => !q || `${i.displayName ?? ""} ${i.result.extracted?.currentCompany ?? ""} ${(i.result.matchedSkills ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase()));

  if (!jobId) return <Empty text="Select an active job above to see its analyzed candidates." />;

  return (
    <div className="space-y-2">
      <div className="rounded-md bg-indigo-50 p-2 text-[11px] leading-snug text-indigo-900">
        <b>No re-scoring:</b> this list is read from your cache. Candidates are analyzed once per job rubric; edit the rubric and they are re-scored next time they appear.
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="grid grid-cols-2 rounded-lg bg-slate-200 p-0.5 text-[11px] font-medium">
          {(
            [
              ["search", "This search"],
              ["job", "Whole job"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => setScope(id)} className={`rounded-md px-2 py-1 ${scope === id ? "bg-white shadow-sm" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>
        <select className="input !w-auto !py-1 text-[12px]" value={minScore} onChange={(e) => setMinScore(+e.target.value)} aria-label="Minimum score">
          <option value={0}>Any score</option>
          <option value={60}>60%+</option>
          <option value={70}>70%+</option>
          <option value={80}>80%+</option>
        </select>
        <input className="input !w-auto min-w-0 flex-1 !py-1 text-[12px]" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="text-[11px] text-indigo-600 hover:underline" onClick={() => void load()} disabled={loading}>
          {loading ? "…" : "↻"}
        </button>
      </div>

      {data && (
        <p className="text-[11px] text-slate-500">
          {data.scope === "search" && data.session ? `Search: ${data.session.label}` : scope === "search" ? "No Naukri search detected yet — showing the whole job." : "All analyzed candidates for this job"} · {items.length} shown
        </p>
      )}
      {error && <p className="rounded bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}

      {!data && loading ? (
        <Empty text="Loading…" />
      ) : items.length === 0 ? (
        <Empty text={scope === "search" ? "Nothing analyzed in this search yet. Cards on the page are scored in Live Ranking." : "No analyzed candidates for this job yet."} />
      ) : (
        <ol className="space-y-2">
          {items.map((i) => (
            <Row key={i.key} item={i} onPage={onPage.get(i.key)} onFocus={(domId) => tabId !== null && void call({ type: "FOCUS_CARD", tabId, domId }).catch(() => {})} />
          ))}
        </ol>
      )}

      {data && data.staleCount > 0 && (
        <p className="text-[11px] text-slate-400">{data.staleCount} older score{data.staleCount > 1 ? "s" : ""} from before the rubric changed {data.staleCount > 1 ? "are" : "is"} hidden — they re-score automatically when those candidates show up again.</p>
      )}
    </div>
  );
}

function Row({ item, onPage, onFocus }: { item: AnalyzedItem; onPage?: RankEntry; onFocus: (domId: string) => void }) {
  const r = item.result;
  const name = item.displayName || r.extracted?.fullName || "Candidate";
  const verdict = r.verdict ?? r.oneLineVerdict ?? "";
  const sub = [r.extracted?.currentRole, r.extracted?.currentCompany].filter(Boolean).join(" @ ");
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold">{name}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${item.kind === "deep" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`} title={item.kind === "deep" ? "Full profile / résumé audit" : "Scored from a search card"}>
            {item.kind === "deep" ? "Deep audit" : "Card"}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${scoreColor(item.score)}`}>{item.score}%</span>
        </span>
      </div>
      {sub && <p className="truncate text-[11px] text-slate-500">{sub}</p>}
      {verdict && <p className="mt-1 line-clamp-2 text-[12px] text-slate-600">{verdict}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {(r.matchedSkills ?? []).slice(0, 4).map((s) => (
          <Pill key={s} tone="green">
            {s}
          </Pill>
        ))}
        {(r.missingSkills ?? []).slice(0, 2).map((s) => (
          <Pill key={s} tone="red">
            ✕ {s}
          </Pill>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="truncate">{[r.noticePeriod, r.ctc].filter(Boolean).join(" · ")}</span>
        <span className="flex shrink-0 items-center gap-2">
          {onPage && (
            <button className="font-medium text-indigo-600 hover:underline" onClick={() => onFocus(onPage.domId)}>
              Show on page
            </button>
          )}
          {item.profileUrl && (
            <a className="font-medium text-indigo-600 hover:underline" href={item.profileUrl} target="_blank" rel="noreferrer">
              Open ↗
            </a>
          )}
        </span>
      </div>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">{text}</p>;
}
