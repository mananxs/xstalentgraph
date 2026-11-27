"use client";

import { CheckCircle2, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { hunt, type ConnectionView } from "@/lib/hunt";
import { Button } from "./hunt/ui";

interface Pairing {
  code: string;
  expiresAt: string;
  connection: string;
}

/** Connect the browser extension to THIS account with a one-time code: no password typed into the extension. */
export function ConnectExtension() {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [conn, setConn] = useState<ConnectionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "connection" | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const poll = () => hunt.connection().then(setConn).catch(() => {});
    void poll();
    const t = setInterval(() => { void poll(); setNow(Date.now()); }, 3000);
    return () => clearInterval(t);
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pairing", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as Partial<Pairing> & { error?: string };
      if (!res.ok || !body.code) throw new Error(body.error ?? "Could not create a code.");
      setPairing(body as Pairing);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a code.");
    } finally {
      setBusy(false);
    }
  }
  const copy = (what: "code" | "connection", text: string) => void navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(null), 1500); });
  const left = pairing ? Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - now) / 1000)) : 0;
  const connected = Boolean(conn?.connected);

  return (
    <div className="space-y-3">
      <p className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${connected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-zinc-50 text-zinc-700"}`}>
        {connected ? <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" /> : <span className="size-2 shrink-0 rounded-full bg-zinc-400" aria-hidden="true" />}
        {connected ? `Extension connected (Naukri: ${(conn?.naukri ?? "unknown").replace("_", " ")}). Last contact ${conn?.lastSeenAt ? Math.max(0, Math.round((now - new Date(conn.lastSeenAt).getTime()) / 1000)) : "?"}s ago.` : conn?.state === "never" ? "No extension has connected to your account yet." : "Your extension is offline right now."}
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600">
        <li>Install the extension: open <code className="text-zinc-800">chrome://extensions</code>, turn on Developer mode, press <b>Load unpacked</b> and pick the extension&apos;s <code className="text-zinc-800">dist</code> folder.</li>
        <li>Click the XS-Hunt icon in Chrome to open its side panel.</li>
        <li>Press <b>Create connection code</b> below, copy it, and paste it in the panel. It works once.</li>
        <li>Upload a JD here. It appears in the extension by itself. Open Resdex and the candidates you look at come back to the job.</li>
      </ol>
      {!pairing || left === 0 ? (
        <Button variant="primary" loading={busy} onClick={() => void create()}>Create connection code</Button>
      ) : (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
          <p className="text-xs text-zinc-600">Paste this into the extension. Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white px-3 py-2 font-mono text-lg font-semibold tracking-wider text-zinc-950 ring-1 ring-zinc-200">{pairing.code}</code>
            <Button onClick={() => copy("connection", pairing.connection)}><Copy className="size-3.5" aria-hidden="true" /> {copied === "connection" ? "Copied" : "Copy connection code"}</Button>
            <Button variant="ghost" onClick={() => copy("code", pairing.code)}>{copied === "code" ? "Copied" : "Copy short code only"}</Button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">&quot;Connection code&quot; carries this site&apos;s address too, so it is the only thing you paste. With the short code you also type the address.</p>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}
