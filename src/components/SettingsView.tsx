"use client";

import { Bot, Cpu, Gauge, PauseCircle, Puzzle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, toMessage } from "@/lib/api";
import type { SystemStatusDto } from "@/lib/types";
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
        <p className="mt-1 text-sm text-zinc-600">How scoring and sourcing are set up. Change these in <code className="text-zinc-700">.env</code> and restart.</p>
      </header>
      {error && <ErrorBanner message={error} />}
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
          <Card icon={<Puzzle className="size-5" aria-hidden="true" />} title="Naukri extension (XS-NaukriAI)">
            <Row label="Platform URL" value={typeof window === "undefined" ? "" : window.location.origin} />
            <Row label="Endpoint" value="/api/ext/shortlist" />
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-zinc-600">
              <li>
                Add <code className="rounded bg-zinc-100 px-1 text-zinc-800">EXTENSION_API_KEY=&lt;16+ random characters&gt;</code> to <code className="rounded bg-zinc-100 px-1 text-zinc-800">.env</code> and restart.
              </li>
              <li>Paste the same key and the platform URL into the extension&apos;s Platform tab.</li>
              <li>Save Card to Shortlist now uploads the card, the score and the resume file here.</li>
            </ol>
          </Card>
          <Card icon={<PauseCircle className="size-5" aria-hidden="true" />} title="Account">
            <p className="text-sm text-zinc-600">Team members, sign-in and per-user settings arrive together with real sign-in (Auth.js).</p>
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
