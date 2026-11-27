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

/**
 * Per-HR login. Each HR signs in with their OWN email + password (the same account as the web app); the extension then holds
 * that HR's key only, so jobs, rubrics, candidates, résumés and searches are never mixed between HRs. Pasting a key is the fallback.
 */
export default function AuthGate() {
  const [mode, setMode] = useState<"login" | "key">("login");
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
      const origin = new URL(baseUrl.trim()).origin; // throws on garbage
      // Ask for access to the backend origin (needs this click as the user gesture). Already-granted/localhost → resolves true.
      await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
      try {
        localStorage.setItem(LAST_URL, origin);
      } catch {
        /* storage unavailable — not important */
      }
      if (mode === "login") await call({ type: "LOGIN", baseUrl: origin, email: email.trim(), password });
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
        <h1 className="text-base font-semibold">Log in to XS-Hunt</h1>
        <p className="text-xs text-slate-500">Use your XS-Hunt account. Jobs, scoring, shortlists and CVs all live there.</p>
      </div>
      <div className="grid grid-cols-2 rounded-lg bg-slate-200 p-0.5 text-[12px] font-medium">
        {(
          [
            ["login", "Email & password"],
            ["key", "Paste API key"],
          ] as const
        ).map(([id, label]) => (
          <button type="button" key={id} onClick={() => setMode(id)} className={`rounded-md py-1 ${mode === id ? "bg-white shadow-sm" : "text-slate-600"}`}>
            {label}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Platform URL</span>
        <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-talentgraph.vercel.app" required />
      </label>
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
      ) : (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Extension key (XS-Hunt → Settings → Create an extension key)</span>
          <input className="input font-mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="tgx_…" required />
        </label>
      )}
      {error && <p className="rounded bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || (mode === "login" ? !email || !password : !apiKey)}>
        {busy ? "Signing in…" : mode === "login" ? "Log in" : "Connect"}
      </button>
    </form>
  );
}
