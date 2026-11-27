"use client";

import { CheckCircle2, CircleDashed, PlugZap, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toMessage } from "@/lib/api";
import type { ConnectionView } from "@/lib/hunt";
import { Button, Card } from "./ui";

const NAUKRI: Record<string, string> = { signed_in: "Naukri Resdex is signed in", signed_out: "Sign in to Naukri Resdex in that browser", captcha: "Naukri shows a security check: solve it in that tab", expired: "Naukri session expired: sign in again", no_tab: "Open a Resdex tab in that browser", unknown: "Naukri state not reported yet" };

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden="true" />}
      <span className={done ? "text-zinc-800" : "text-zinc-600"}>{children}</span>
    </li>
  );
}

/** The whole extension hand-off on one strip: connected -> Naukri ready -> this job sent -> candidates arriving. */
export function ExtensionStrip({ jobId, conn, canEdit, captured }: { jobId: string; conn: ConnectionView | null; canEdit: boolean; captured: number }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = Boolean(conn?.connected);
  const ready = connected && conn?.naukri === "signed_in";

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/extension`, { method: "POST" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not send the job.");
      setSent(true);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-950"><PlugZap className="size-4 text-accent" aria-hidden="true" /> Naukri extension</h2>
          <ul className="mt-2 space-y-1.5">
            <Step done={connected}>{connected ? "Extension connected to your account" : conn?.state === "never" ? "Not connected yet. Connect it once from Settings." : "Extension is offline. Open Chrome with the extension."}</Step>
            <Step done={ready}>{connected ? (NAUKRI[conn?.naukri ?? "unknown"] ?? NAUKRI.unknown) : "Naukri state appears once the extension is connected"}</Step>
            <Step done={sent}>{sent ? "This job was sent: the extension switches to it within a few seconds" : "Send this job to the extension (it also happens when you upload a JD or start sourcing)"}</Step>
            <Step done={captured > 0}>{captured > 0 ? `${captured} candidate${captured === 1 ? "" : "s"} received from Naukri` : "Open Resdex and search: the candidates you view arrive here by themselves"}</Step>
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          {!connected && <Link href="/settings#connect" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50">Connect extension</Link>}
          <Button variant="primary" disabled={!canEdit} loading={busy} onClick={() => void send()}><Send className="size-3.5" aria-hidden="true" /> Send to extension</Button>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    </Card>
  );
}
