"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

/** Catches rendering errors in any page, so one broken widget never blanks the whole app. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center">
      <AlertTriangle className="size-10 text-tier-low" aria-hidden="true" />
      <h1 className="mt-4 text-xl font-semibold">This page hit a problem</h1>
      <p className="mt-2 text-sm text-zinc-600">Your data is safe. Try again, or open another page from the menu.</p>
      {error.message && <p className="mt-3 max-w-full truncate text-xs text-zinc-500">{error.message}</p>}
      <button
        type="button"
        onClick={reset}
        className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        <RotateCcw className="size-4" aria-hidden="true" /> Try again
      </button>
    </div>
  );
}
