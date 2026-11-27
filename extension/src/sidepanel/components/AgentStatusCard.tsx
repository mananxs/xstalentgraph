import { useEffect, useState } from "react";
import type { AgentStatus } from "../../background/agent";
import { K, type ActiveJob } from "../../shared/types";
import { call, useSettings, useStorage } from "../lib";

const NAUKRI_TEXT: Record<string, string> = {
  signed_in: "Naukri: signed in",
  signed_out: "Naukri: signed out. Sign in to Resdex.",
  captcha: "Naukri: asking for a security check. Solve it yourself, then resume.",
  expired: "Naukri: session expired. Sign in again.",
  no_tab: "Naukri: no Resdex tab open",
  unknown: "Naukri: not checked yet",
};

/** What the extension is doing for XS-Hunt right now. Only facts: the last heartbeat result, the Naukri state it saw, the run it is executing. */
export default function AgentStatusCard() {
  const status = useStorage<AgentStatus>("local", "agent.status");
  const job = useStorage<ActiveJob>("local", K.activeJob);
  const [settings, setSettings] = useSettings();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const fresh = !!status?.lastOkAt && now - status.lastOkAt < 60_000;
  const connected = !!status?.connected && fresh;
  const run = status?.run;
  const tone = connected ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <section className={`space-y-1 rounded-xl border p-3 text-[12px] ${tone}`} aria-label="XS-Hunt connection">
      <div className="flex items-center justify-between">
        <b>{connected ? "Connected to XS-Hunt" : status ? "Not connected to XS-Hunt" : "Connecting…"}</b>
        <button className="text-[11px] underline" onClick={() => void call({ type: "AGENT_TICK" }).catch(() => {})}>
          Check now
        </button>
      </div>
      {!connected && status?.error && <p>{status.error}</p>}
      {!connected && status?.lastOkAt && <p>Last contact {Math.round((now - status.lastOkAt) / 1000)}s ago.</p>}
      <p>{NAUKRI_TEXT[status?.naukri ?? "unknown"] ?? NAUKRI_TEXT.unknown}</p>
      <p>{job ? <>Job: <b>{job.title}</b></> : "No job yet. Upload a JD in XS-Hunt and it appears here by itself."}</p>
      <label className="flex items-start gap-1.5">
        <input type="checkbox" className="mt-0.5" checked={settings.autoSend} onChange={(e) => setSettings({ autoSend: e.target.checked })} />
        <span>Send candidates I view in Resdex to this job in XS-Hunt automatically <span className="opacity-70">(no AI is used for sending)</span></span>
      </label>
      {run && run.state !== "idle" && (
        <p>
          Sourcing <b>{run.state}</b>: {run.pagesDone} page{run.pagesDone === 1 ? "" : "s"} read, {run.captured} candidates sent (limit {run.limits.maxPages} pages / {run.limits.maxCandidates} candidates).
        </p>
      )}
      {status?.note && <p className="opacity-80">Last command: {status.note}</p>}
      <p className="opacity-80">Start, pause and stop sourcing from the job page in XS-Hunt. Profiles and CVs are opened only after you approve them there.</p>
    </section>
  );
}
