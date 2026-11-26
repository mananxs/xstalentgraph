import { useEffect, useMemo, useRef, useState } from "react";
import { K, WORTH_LABEL, worthOf, type CardSavePayload, type RankEntry, type SaveMap, type Worth } from "../../shared/types";
import { hashStr, resultMatchesCard } from "../../shared/util";
import { call, scoreColor, useSettings, useStorage } from "../lib";
import { Pill } from "../Pill";

interface Props {
  tabId: number | null;
  onResdex: boolean;
  jobId?: string;
  onAudit: (e: RankEntry) => void;
}

const TIER_STYLE: Record<Worth, { badge: string; ring: string; icon: string }> = {
  open: { badge: "bg-emerald-600 text-white", ring: "border-l-4 border-l-emerald-500", icon: "★ " },
  review: { badge: "bg-amber-500 text-white", ring: "border-l-4 border-l-amber-400", icon: "" },
  skip: { badge: "bg-slate-500 text-white", ring: "border-l-4 border-l-slate-300", icon: "" },
};
const TIER_ORDER: Record<Worth, number> = { open: 0, review: 1, skip: 2 };

export default function LiveRankingTab({ tabId, onResdex, jobId, onAudit }: Props) {
  const entries = useStorage<RankEntry[]>("session", tabId === null ? null : K.rank(tabId)) ?? [];
  const saved = useStorage<SaveMap>("session", tabId === null ? null : K.saved(tabId)) ?? {};
  const focus = useStorage<{ domId: string; ts: number }>("session", tabId === null ? null : K.focus(tabId));
  const [worthOnly, setWorthOnly] = useState(false);
  const [maxNotice, setMaxNotice] = useState(0); // 0 = any
  const [minScore, setMinScore] = useState(0);
  const [saveErr, setSaveErr] = useState("");
  const [settings, setSettings] = useSettings();
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!focus) return;
    rowRefs.current.get(focus.domId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(focus.domId);
    const t = setTimeout(() => setFlash(null), 2000);
    return () => clearTimeout(t);
  }, [focus]);

  // Defence in depth: a result whose name is not on the card it is attached to is never listed (it belongs to someone else).
  const scored = entries.filter((e) => e.state === "done" && e.result && resultMatchesCard(e.result.extracted, e.rawText));
  const pending = entries.filter((e) => e.state === "pending").length;
  const failed = entries.filter((e) => e.state === "error").length;
  const unscored = entries.filter((e) => e.state === "unscored");
  const cachedCount = scored.filter((e) => e.result?.cached).length;
  const counts = useMemo(() => {
    const c: Record<Worth, number> = { open: 0, review: 0, skip: 0 };
    for (const e of scored) c[worthOf(e.result!)]++;
    return c;
  }, [scored]);

  const keyOf = (e: RankEntry) => hashStr(`${jobId ?? ""}|${e.rawText}`);
  const payload = (e: RankEntry): CardSavePayload => ({ key: keyOf(e), domId: e.domId, label: e.label, rawText: e.rawText, profileUrl: e.profileUrl, result: e.result! });

  const rows = useMemo(
    () =>
      scored
        .filter((e) => !worthOnly || worthOf(e.result!) === "open")
        .filter((e) => e.result!.score >= minScore)
        .filter((e) => !maxNotice || (e.result!.noticeDays >= 0 && e.result!.noticeDays <= maxNotice))
        .sort((a, b) => TIER_ORDER[worthOf(a.result!)] - TIER_ORDER[worthOf(b.result!)] || b.result!.score - a.result!.score),
    [scored, worthOnly, minScore, maxNotice],
  );

  // Not-yet-saved High-Priority cards among ALL scored cards (not just the filtered ones — the label says "High-Priority").
  const unsavedPriority = scored.filter((e) => worthOf(e.result!) === "open" && saved[keyOf(e)]?.status !== "saved" && saved[keyOf(e)]?.status !== "saving");

  async function save(list: RankEntry[]) {
    if (tabId === null || !list.length) return;
    setSaveErr("");
    try {
      await call({ type: "SAVE_CARDS", tabId, cards: list.map(payload) });
    } catch (e) {
      setSaveErr((e as Error).message);
    }
  }

  if (!onResdex) return <Empty text="Open a Resdex search results page — candidate cards will be scored automatically (or switch to the Analyzed tab to browse what you've already scored)." />;
  if (!jobId) return <Empty text="Select an active job above to start scoring." />;

  return (
    <div className="space-y-2">
      <p className="rounded-md bg-indigo-50 p-2 text-[11px] leading-snug text-indigo-900">
        <b>Protect your CV quota:</b> opening a profile spends 1 view. Rank, filter and save from the cards first — only open <span className="font-semibold text-emerald-700">★ Worth 1 CV View</span> candidates.
      </p>

      <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
        {(["open", "review", "skip"] as const).map((w) => (
          <div key={w} className="rounded-md border border-slate-200 bg-white py-1">
            <div className="text-base font-bold leading-none">{counts[w]}</div>
            <div className="mt-0.5 text-slate-500">{w === "open" ? "High priority" : w === "review" ? "Borderline" : "Skip"}</div>
          </div>
        ))}
      </div>

      <div className="space-y-1 rounded-md border border-slate-200 bg-white p-2">
        <div className="flex items-center justify-between gap-2">
          <Toggle on={settings.analyzedOnly} set={(v) => setSettings({ analyzedOnly: v })} label="Analyzed only" />
          {settings.analyzedOnly && unscored.length > 0 && tabId !== null && (
            <button className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700" onClick={() => void call({ type: "SCORE_PENDING", tabId }).catch(() => {})}>
              Score {unscored.length} new card{unscored.length > 1 ? "s" : ""}
            </button>
          )}
        </div>
        <p className="text-[11px] leading-snug text-slate-500">
          {settings.analyzedOnly
            ? `Showing only candidates you've already analyzed — new cards are NOT sent to the AI${unscored.length ? ` (${unscored.length} waiting)` : ""}.`
            : settings.scoring
              ? `New cards are scored automatically; ones analyzed before are reused from cache${cachedCount ? ` (${cachedCount} from cache, no AI call)` : ""}.`
              : `Scoring is stopped${unscored.length ? ` (${unscored.length} waiting)` : ""}. Press START to analyze new cards; analyzed ones are reused from cache.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Toggle on={worthOnly} set={setWorthOnly} label="★ Worth opening only" />
        <select className="input !w-auto !py-1 text-[12px]" value={maxNotice} onChange={(e) => setMaxNotice(+e.target.value)} aria-label="Notice period">
          <option value={0}>Any notice</option>
          <option value={15}>≤ 15 days</option>
          <option value={30}>≤ 30 days</option>
          <option value={60}>≤ 60 days</option>
        </select>
        <select className="input !w-auto !py-1 text-[12px]" value={minScore} onChange={(e) => setMinScore(+e.target.value)} aria-label="Minimum score">
          <option value={0}>Any score</option>
          <option value={50}>50%+</option>
          <option value={60}>60%+</option>
          <option value={70}>70%+</option>
          <option value={80}>80%+</option>
        </select>
        <span className="ml-auto text-[11px] text-slate-500">
          {rows.length}/{scored.length} shown{pending ? ` · ${pending} scoring…` : ""}
          {failed ? ` · ${failed} failed` : ""}
        </span>
      </div>

      <button
        className="btn-primary w-full"
        disabled={unsavedPriority.length === 0}
        onClick={() => void save(unsavedPriority)}
        title="Saves card data only — no profile is opened, no CV view is used. Runs only when you click."
      >
        Save All High-Priority Cards ({unsavedPriority.length})
      </button>
      {saveErr && <p className="rounded bg-rose-50 p-2 text-xs text-rose-700">{saveErr}</p>}

      {rows.length === 0 ? (
        <Empty text={entries.length === 0 ? "No candidate cards detected yet. Run a search on Resdex." : pending ? "Scoring candidates…" : unscored.length && !scored.length ? (settings.scoring ? "None of these cards are analyzed yet. Turn off “Analyzed only” or press “Score new cards”." : "Scoring is stopped. Press START above to analyze these cards.") : "No candidates match these filters."} />
      ) : (
        <ol className="space-y-2">
          {rows.map((e, i) => {
            const r = e.result!;
            const w = worthOf(r);
            const st = TIER_STYLE[w];
            const sv = saved[keyOf(e)];
            return (
              <li
                key={e.domId}
                ref={(el) => {
                  if (el) rowRefs.current.set(e.domId, el);
                  else rowRefs.current.delete(e.domId);
                }}
                onClick={() => tabId !== null && void call({ type: "FOCUS_CARD", tabId, domId: e.domId }).catch(() => {})}
                className={`cursor-pointer rounded-lg border bg-white p-2.5 shadow-sm transition hover:border-indigo-300 ${st.ring} ${w === "skip" ? "opacity-75" : ""} ${flash === e.domId ? "border-indigo-500 ring-2 ring-indigo-200" : "border-slate-200"}`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 text-[11px] text-slate-400">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold">
                        {r.extracted?.fullName || e.label}
                        {r.cached && <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 align-middle text-[9px] font-semibold uppercase text-slate-500" title="Already analyzed — served from your score cache, no AI call">analyzed</span>}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${scoreColor(r.score)}`}>{r.score}%</span>
                    </div>
                    {r.extracted && (r.extracted.currentRole || r.extracted.currentCompany) && (
                      <p className="truncate text-[11px] text-slate-500">{[r.extracted.currentRole, r.extracted.currentCompany].filter(Boolean).join(" @ ")}</p>
                    )}
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${st.badge}`} title={WORTH_LABEL[w].long}>
                        {st.icon}
                        {WORTH_LABEL[w].short}
                      </span>
                      {r.worthReasons?.[0] && <span className="truncate text-[10px] text-slate-500">{r.worthReasons.slice(0, 2).join(" · ")}</span>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12px] text-slate-600">{r.oneLineVerdict}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.matchedSkills.slice(0, 4).map((s) => (
                        <Pill key={s} tone="green">
                          {s}
                        </Pill>
                      ))}
                      {r.missingSkills.slice(0, 2).map((s) => (
                        <Pill key={s} tone="red">
                          ✕ {s}
                        </Pill>
                      ))}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span className="truncate">
                        {r.noticePeriod} · {r.ctc}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <button
                          className={`rounded border px-1.5 py-0.5 font-medium ${sv?.status === "saved" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : sv?.status === "error" ? "border-rose-300 text-rose-700" : "border-indigo-300 text-indigo-700 hover:bg-indigo-50"}`}
                          disabled={sv?.status === "saving" || sv?.status === "saved"}
                          title={sv?.status === "error" ? sv.error : "Saves card data to your shortlist — no profile opened, no CV view used"}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void save([e]);
                          }}
                        >
                          {sv?.status === "saving" ? "Saving…" : sv?.status === "saved" ? (sv.keptFullProfile ? "In shortlist ✓" : sv.duplicate ? "Updated ✓" : "Saved ✓") : sv?.status === "error" ? "Retry save" : "Save Card to Shortlist"}
                        </button>
                        <button
                          className="font-medium text-indigo-600 hover:underline"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onAudit(e);
                          }}
                        >
                          Deep audit →
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {unscored.length > 0 && (
        <details className="rounded-md border border-slate-200 bg-white p-2 text-[12px]">
          <summary className="cursor-pointer font-medium text-slate-600">Not analyzed yet ({unscored.length})</summary>
          <ul className="mt-1.5 space-y-1">
            {unscored.map((e) => (
              <li key={e.domId} className="flex items-center justify-between gap-2 text-slate-600">
                <button className="truncate text-left hover:text-indigo-600" onClick={() => tabId !== null && void call({ type: "FOCUS_CARD", tabId, domId: e.domId }).catch(() => {})}>
                  {e.label}
                </button>
                <button className="shrink-0 text-[11px] font-medium text-indigo-600 hover:underline" onClick={() => onAudit(e)} title="Deep-audit this card now">
                  Analyze →
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Toggle({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <button onClick={() => set(!on)} aria-pressed={on} className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-600"}`}>
      {label}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">{text}</p>;
}
