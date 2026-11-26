import type { RankEntry } from "../../shared/types";
import { K } from "../../shared/types";
import { useSettings, useStorage } from "../lib";

/**
 * START / STOP scoring. Red = stopped: nothing is sent to the AI (already-analyzed cards still show from cache).
 * Green = scoring: new cards are scored as they appear. Always starts red after a browser restart or login.
 */
export default function ScoringToggle({ tabId, onResdex }: { tabId: number | null; onResdex: boolean }) {
  const [settings, setSettings] = useSettings();
  const entries = useStorage<RankEntry[]>("session", tabId === null ? null : K.rank(tabId)) ?? [];
  const waiting = entries.filter((e) => e.state === "unscored").length;
  const scoring = entries.filter((e) => e.state === "pending").length;
  const done = entries.filter((e) => e.state === "done").length;
  const on = settings.scoring;

  return (
    <section className="space-y-1.5">
      <button
        type="button"
        aria-pressed={on}
        disabled={!onResdex}
        onClick={() => setSettings({ scoring: !on })}
        className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-white shadow-sm transition-colors disabled:opacity-50 ${on ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full bg-white ${on && scoring > 0 ? "animate-pulse" : ""}`} aria-hidden="true" />
        {on ? "SCORING · press to STOP" : "STOPPED · press to START scoring"}
      </button>
      <p className="text-center text-[11px] leading-snug text-slate-500">
        {!onResdex
          ? "Open a Resdex search page to use scoring."
          : on
            ? `${done} scored${scoring ? ` · ${scoring} in progress` : ""}. New cards on this page are analyzed automatically${settings.analyzedOnly ? " (but “Analyzed only” is on, so none are sent)" : ""}.`
            : `Nothing is sent to the AI while stopped${waiting ? ` · ${waiting} card${waiting > 1 ? "s" : ""} waiting` : ""}. Already-analyzed candidates still show.`}
      </p>
    </section>
  );
}
