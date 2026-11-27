"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

const ERRORS: Record<string, string> = {
  google_domain: "That Google account is not on the company domain. Sign in with your work address.",
  google_unverified: "Your Google e-mail is not verified.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "The sign-in session expired. Please try again.",
  google_exchange: "Google did not accept the sign-in. Please try again.",
  google_profile: "Google did not return your profile. Please try again.",
  google_failed: "Something went wrong signing you in. Please try again.",
  google_not_configured: "Google sign-in is not set up yet. Ask the admin to add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
};

interface Options {
  google: boolean;
  password: boolean;
  domain: string;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.1 5.5c4.2-3.9 7.2-9.6 7.2-17z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.3-8.8 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<Options | null>(null);
  const [next, setNext] = useState("/dashboard");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const n = q.get("next");
    if (n && n.startsWith("/") && !n.startsWith("//")) setNext(n);
    const e = q.get("error");
    if (e) setError(ERRORS[e] ?? "Could not sign in.");
    fetch("/api/auth/options").then((r) => r.json()).then(setOptions).catch(() => setOptions({ google: false, password: true, domain: "xsassociates.com" }));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not sign in.");
      window.location.assign(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
      setBusy(false);
    }
  }

  const field = "h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="fixed right-4 top-4"><ThemeToggle /></div>
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <Logo alwaysShowName />
        <h1 className="mt-6 text-xl font-semibold text-zinc-950">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-600">{options?.google ? `Use your @${options.domain} Google account. Your jobs and candidates stay private to you.` : "Use the email and password your admin created for you."}</p>

        {options?.google && (
          <a href={`/api/auth/google?next=${encodeURIComponent(next)}`} className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-zinc-300 bg-white text-sm font-medium text-zinc-900 transition hover:bg-zinc-50">
            <GoogleMark /> Continue with Google
          </a>
        )}

        {options?.google && options.password && <div className="my-4 flex items-center gap-3 text-xs text-zinc-500"><span className="h-px flex-1 bg-zinc-200" />or<span className="h-px flex-1 bg-zinc-200" /></div>}

        {(options === null || options.password) && (
          <form onSubmit={submit}>
            <label className="mt-1 block text-sm font-medium text-zinc-800">
              Email
              <input className={`${field} mt-1`} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="mt-3 block text-sm font-medium text-zinc-800">
              Password
              <input className={`${field} mt-1`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button disabled={busy || !email || !password} className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-60">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-tier-low">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
