"use client";

import { CheckCircle2, KeyRound, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, inputClass } from "./hunt/ui";

type Provider = "groq" | "gemini";
interface KeyStatus {
  provider: Provider;
  last4: string;
  status: string;
  coolingUntil: string | null;
  lastError: string | null;
  lastUsedAt: string | null;
  useCount: number;
}
interface State {
  keys: KeyStatus[];
  platformFallback: boolean;
  order: Provider[];
}

const INFO: Record<Provider, { name: string; hint: string; get: string; placeholder: string }> = {
  groq: { name: "Groq", hint: "Fast and free to start.", get: "console.groq.com/keys", placeholder: "gsk_…" },
  gemini: { name: "Gemini", hint: "Google AI Studio key.", get: "aistudio.google.com/apikey", placeholder: "AIza…" },
};

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

/** Your own Groq and Gemini keys. They are tried first for everything you run; the team's key is only the fallback. */
export function AiKeysPanel({ onChange, compact = false }: { onChange?: () => void; compact?: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [drafts, setDrafts] = useState<Record<Provider, string>>({ groq: "", gemini: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => call<State>("GET", "/api/ai-keys").then(setState).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load your keys.")), []);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(id); setError(null); setNote(null);
    try { await fn(); if (done) setNote(done); await load(); onChange?.(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(null); }
  }

  const order = state?.order ?? ["groq", "gemini"];
  return (
    <div className="space-y-3">
      {!compact && (
        <p className="text-sm text-zinc-600">
          Add your own key and every score, JD read and CV check you run uses <b>your</b> quota first. If both of your keys are missing, rate limited or rejected, XS-Hunt falls back to the team&apos;s key{state && !state.platformFallback ? " (none is set up right now, so scoring would use the offline Quick score)" : ""}.
        </p>
      )}
      {order.map((p, i) => {
        const info = INFO[p];
        const saved = state?.keys.find((k) => k.provider === p);
        return (
          <div key={p} className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-700">{i + 1}</span>
              <span className="text-sm font-semibold text-zinc-950">{info.name} key</span>
              <span className="text-xs text-zinc-500">{info.hint} Get one at {info.get}</span>
              {saved && (
                <Badge tone={saved.status === "active" ? "green" : saved.status === "cooling" ? "amber" : "red"} className="ml-auto">
                  {saved.status === "active" ? <><CheckCircle2 className="size-3" aria-hidden="true" /> Active</> : saved.status === "cooling" ? <><RefreshCw className="size-3" aria-hidden="true" /> Resting until {when(saved.coolingUntil)}</> : <><ShieldAlert className="size-3" aria-hidden="true" /> Rejected</>}
                </Badge>
              )}
            </div>
            {saved && (
              <p className="mt-2 text-xs text-zinc-600">
                <span className="font-mono">••••{saved.last4}</span> · used {saved.useCount} time{saved.useCount === 1 ? "" : "s"} · last used {when(saved.lastUsedAt)}
                {saved.lastError && <span className="mt-1 block text-amber-800">{saved.lastError}</span>}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className={`${inputClass} min-w-0 flex-1 font-mono`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={saved ? `Replace the ${info.name} key (${info.placeholder})` : `Paste your ${info.name} key (${info.placeholder})`}
                value={drafts[p]}
                onChange={(e) => setDrafts({ ...drafts, [p]: e.target.value })}
                aria-label={`${info.name} API key`}
              />
              <Button variant="primary" disabled={drafts[p].trim().length < 20} loading={busy === `save-${p}`} onClick={() => void act(`save-${p}`, async () => { await call("PUT", "/api/ai-keys", { provider: p, key: drafts[p] }); setDrafts({ ...drafts, [p]: "" }); }, `${info.name} key checked and saved.`)}>
                <KeyRound className="size-3.5" aria-hidden="true" /> {saved ? "Replace" : "Save"}
              </Button>
              {saved && (
                <>
                  <Button loading={busy === `test-${p}`} onClick={() => void act(`test-${p}`, () => call("POST", "/api/ai-keys", { provider: p }), `${info.name} key re-checked.`)}>Check again</Button>
                  <Button variant="danger" aria-label={`Remove the ${info.name} key`} loading={busy === `del-${p}`} onClick={() => void act(`del-${p}`, () => call("DELETE", `/api/ai-keys?provider=${p}`), `${info.name} key removed.`)}><Trash2 className="size-3.5" aria-hidden="true" /></Button>
                </>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-zinc-500">Order used: your {INFO[order[0]!].name} key, then your {INFO[order[1]!].name} key, then the team key. Keys are encrypted on the server and never shown again.</p>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {note && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{note}</p>}
    </div>
  );
}
