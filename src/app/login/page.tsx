"use client";

import { useState } from "react";
import { Logo } from "@/components/Logo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not sign in.");
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/pipeline");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
      setBusy(false);
    }
  }

  const field = "h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <Logo alwaysShowName />
        <h1 className="mt-6 text-xl font-semibold text-zinc-950">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-600">Use the email and password your admin created for you.</p>
        <label className="mt-5 block text-sm font-medium text-zinc-800">
          Email
          <input className={`${field} mt-1`} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="mt-3 block text-sm font-medium text-zinc-800">
          Password
          <input className={`${field} mt-1`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-tier-low">
            {error}
          </p>
        )}
        <button disabled={busy || !email || !password} className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-60">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
