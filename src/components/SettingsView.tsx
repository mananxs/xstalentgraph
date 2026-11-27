"use client";

import { Bot, Cpu, Gauge, KeyRound, PauseCircle, Puzzle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, toMessage } from "@/lib/api";
import type { SystemStatusDto } from "@/lib/types";
import { AiKeysPanel } from "./AiKeysPanel";
import { ConnectExtension } from "./ConnectExtension";
import { ErrorBanner } from "./ErrorBanner";

/** Read-only view of how the platform is configured (no secrets are shown). */
export function SettingsView() {
  const [status, setStatus] = useState<SystemStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .systemStatus()
      .then(setStatus)
      .catch((caught: unknown) => setError(toMessage(caught)));
  }, []);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-zinc-600">Your AI keys and extension connection, plus how the platform itself is set up.</p>
      </header>
      {error && <ErrorBanner message={error} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={<KeyRound className="size-5" aria-hidden="true" />} title="Your AI keys"><AiKeysPanel /></Card>
        <section id="connect" className="card-surface scroll-mt-20 rounded-2xl border border-zinc-200 p-5">
          <h2 className="mb-3 flex items-center gap-2 font-medium text-zinc-950"><span className="text-accent"><Puzzle className="size-5" aria-hidden="true" /></span>Connect extension</h2>
          <ConnectExtension />
        </section>
      </div>
      {status && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card icon={<Bot className="size-5" aria-hidden="true" />} title="AI engine">
            <Row label="Provider" value={status.ai.provider} />
            <Row label="State" value={!status.ai.configured ? "No key: Quick score only" : status.ai.paused ? "Paused after errors (auto-resumes)" : "Ready"} />
            <Row label="Groq backup" value={status.ai.groq ? "On" : "Off"} />
            <div className="mt-2">
              <p className="text-xs text-zinc-500">Model chain (tried in order)</p>
              <ol className="mt-1 flex flex-wrap gap-1">
                {status.ai.models.map((model) => (
                  <li key={model} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                    {model}
                  </li>
                ))}
              </ol>
            </div>
          </Card>
          <Card icon={<Gauge className="size-5" aria-hidden="true" />} title="Sourcing">
            <Row label="Profiles per run" value={String(status.sourcing.maxProfiles)} />
            <Row label="Shown on the pipeline" value={`Top ${status.sourcing.displayed}`} />
            <Row label="Fallback" value="Offline Quick score when the AI is unavailable" />
          </Card>
          <Card icon={<Cpu className="size-5" aria-hidden="true" />} title="Background worker">
            <Row label="Embedded in the web server" value={status.worker.embedded ? "Yes" : "No (run npm run worker)"} />
          </Card>
          <Card icon={<Puzzle className="size-5" aria-hidden="true" />} title="Extension key (advanced)">
            <ExtensionKey />
          </Card>
          <Card icon={<PauseCircle className="size-5" aria-hidden="true" />} title="Account">
            <p className="text-sm text-zinc-600">Signed in with your company Google account. Managers and admins can see every HR&apos;s work; you see your own. Manage members under Team &amp; Permissions.</p>
          </Card>
        </div>
      )}
    </div>
  );
}

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="card-surface rounded-2xl border border-zinc-200 p-5">
      <h2 className="mb-3 flex items-center gap-2 font-medium text-zinc-950">
        <span className="text-accent">{icon}</span>
        {title}
      </h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-4 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right text-zinc-800">{value}</span>
    </p>
  );
}

/** Creates a personal key for the extension. Shown once; the extension logs in with email + password too. */
function ExtensionKey() {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/extension-keys", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { apiKey?: string; error?: string };
      if (!response.ok || !body.apiKey) throw new Error(body.error ?? "Could not create a key.");
      setKey(body.apiKey);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create a key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Row label="Platform URL" value={typeof window === "undefined" ? "" : window.location.origin} />
      <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-zinc-600">
        <li>In the extension panel, enter this Platform URL.</li>
        <li>Log in with your XS-Hunt email and password, or paste a key created below.</li>
        <li>Jobs, scoring, analyzed lists, shortlists and CVs all live here.</li>
      </ol>
      {key ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-medium text-emerald-900">Copy it now: it is shown only once.</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs text-zinc-900">{key}</code>
          <button
            type="button"
            className="mt-2 text-xs font-medium text-emerald-800 hover:underline"
            onClick={() => void navigator.clipboard.writeText(key).then(() => setCopied(true))}
          >
            {copied ? "Copied" : "Copy key"}
          </button>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => void create()} className="mt-3 inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60">
          {busy ? "Creating…" : "Create an extension key"}
        </button>
      )}
      {error && <p className="mt-2 text-sm text-tier-low">{error}</p>}
    </>
  );
}
