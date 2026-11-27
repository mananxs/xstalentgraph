"use client";

import { KeyRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AiKeysPanel } from "./AiKeysPanel";
import { Button } from "./hunt/ui";

const KEY = "xs-ai-prompt-until";

/** Asked once after sign-in while the HR has no key of their own. "Later" hides it for a day; saving a key closes it for good. */
export function AiKeyPrompt() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let until = 0;
    try { until = Number(localStorage.getItem(KEY) ?? 0); } catch { /* blocked storage: just ask */ }
    if (Date.now() < until) return;
    fetch("/api/me").then((r) => (r.ok ? r.json() : null)).then((me: { hasAiKey?: boolean } | null) => { if (me && !me.hasAiKey) setOpen(true); }).catch(() => {});
  }, []);
  if (!open) return null;
  const later = () => {
    try { localStorage.setItem(KEY, String(Date.now() + 24 * 3600_000)); } catch { /* ignore */ }
    setOpen(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="ai-prompt-title">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-full bg-accent/15 text-accent"><KeyRound className="size-4" aria-hidden="true" /></span><h2 id="ai-prompt-title" className="text-base font-semibold text-zinc-950">Use your own AI key</h2></div>
          <button type="button" onClick={later} aria-label="Ask me later" className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"><X className="size-4" aria-hidden="true" /></button>
        </div>
        <p className="mt-2 text-sm text-zinc-600">Add a Groq and/or Gemini key. Your scoring runs on your quota first; the team&apos;s key is used only if yours is missing, rate limited or rejected.</p>
        <div className="mt-4"><AiKeysPanel compact onChange={() => setOpen(false)} /></div>
        <div className="mt-4 flex justify-end"><Button onClick={later}>Later</Button></div>
      </div>
    </div>
  );
}
