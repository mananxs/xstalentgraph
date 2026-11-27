import { useState } from "react";
import type { Config } from "../../shared/types";
import { call } from "../lib";

const LAST_URL = "xs.lastBaseUrl";
const remembered = () => {
  try {
    return localStorage.getItem(LAST_URL) || "http://localhost:3000";
  } catch {
    return "http://localhost:3000";
  }
};

/** "xsh1.<base64url JSON {u: site, c: code}>" (what XS-Hunt shows) -> { url, code }; a bare code returns url null. */
export function parseConnection(text: string): { url: string | null; code: string } | null {
  const t = text.trim();
  if (t.startsWith("xsh1.")) {
    try {
      const json = JSON.parse(atob(t.slice(5).replace(/-/g, "+").replace(/_/g, "/"))) as { u?: string; c?: string };
      if (json.u && json.c) return { url: json.u, code: json.c };
    } catch {
      return null;
    }
    return null;
  }
  return /^(XSH)?[-\s]?[A-Za-z0-9]{4}[-\s]?[A-Za-z0-9]{4}$/i.test(t) ? { url: null, code: t } : null;
}

/**
 * Per-HR connection. The easy way: in XS-Hunt open Settings > Connect extension, copy the connection code and paste it here (no password).
 * Email + password and pasting a key still work as fallbacks. Each HR signs in with their OWN email + password (the same account as the web app); the extension then holds
 * that HR's key only, so jobs, rubrics, candidates, résumés and searches are never mixed between HRs. Pasting a key is the fallback.
 */
export default function AuthGate() {
  const [mode, setMode] = useState<"code" | "login" | "key">("code");
  const [connection, setConnection] = useState("");
  const [baseUrl, setBaseUrl] = useState(remembered);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const parsed = mode === "code" ? parseConnection(connection) : null;
      if (mode === "code" && !parsed) throw new Error("That does not look like a connection code. Copy it again from XS-Hunt > Settings > Connect extension.");
      const origin = new URL((parsed?.url ?? baseUrl).trim()).origin; // throws on garbage
      // Ask for access to the backend origin (needs this click as the user gesture). Already-granted/localhost → resolves true.
      await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
      try {
        localStorage.setItem(LAST_URL, origin);
      } catch {
        /* storage unavailable — not important */
      }
      if (mode === "code") await call({ type: "PAIR", baseUrl: origin, code: parsed!.code });
      else if (mode === "login") await call({ type: "LOGIN", baseUrl: origin, email: email.trim(), password });
      else await call({ type: "CONNECT", config: { baseUrl: origin, apiKey: apiKey.trim() } satisfies Config });
      setPassword("");
      // the background persists the config; App re-renders through useStorage
    } catch (err) {
      setError(err instanceof TypeError ? "Enter a valid URL, e.g. https://your-app.vercel.app" : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-6 max-w-sm space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h1 className="text-base font-semibold">Connect to XS-Hunt</h1>
        <p className="text-xs text-slate-500">Link this browser to your XS-Hunt account. Jobs you upload there show up here, and candidates you view in Resdex go back to them.</p>
      </div>
      <div className="grid grid-cols-3 rounded-lg bg-slate-200 p-0.5 text-[12px] font-medium">
        {(
          [
            ["code", "Code"],
            ["login", "Password"],
            ["key", "API key"],
          ] as const
        ).map(([id, label]) => (
          <button type="button" key={id} onClick={() => setMode(id)} className={`rounded-md py-1 ${mode === id ? "bg-white shadow-sm" : "text-slate-600"}`}>
            {label}
          </button>
        ))}
      </div>
      {mode === "code" ? (
        <>
          <ol className="list-decimal space-y-0.5 pl-4 text-[11px] text-slate-600">
            <li>In XS-Hunt open <b>Settings → Connect extension</b>.</li>
            <li>Press <b>Create connection code</b> and copy it.</li>
            <li>Paste it below. It works once and expires in 10 minutes.</li>
          </ol>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Connection code</span>
            <input className="input font-mono" value={connection} onChange={(e) => setConnection(e.target.value)} placeholder="xsh1.… or XSH-ABCD-2345" autoComplete="off" spellCheck={false} required />
          </label>
          {connection.trim() !== "" && parseConnection(connection)?.url === null && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">XS-Hunt address</span>
              <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-app.vercel.app" required />
            </label>
          )}
        </>
      ) : (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Platform URL</span>
          <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-app.vercel.app" required />
        </label>
      )}
      {mode === "login" ? (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Password</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
        </>
      ) : mode === "key" ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Extension key (XS-Hunt → Settings → Create an extension key)</span>
          <input className="input font-mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="tgx_…" required />
        </label>
      ) : null}
      {error && <p className="rounded bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || (mode === "code" ? !connection.trim() : mode === "login" ? !email || !password : !apiKey)}>
        {busy ? "Connecting…" : mode === "login" ? "Log in" : "Connect"}
      </button>
    </form>
  );
}
