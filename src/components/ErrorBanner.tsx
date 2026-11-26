import { AlertTriangle } from "lucide-react";

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

/** Red banner for failed requests, with an optional retry button. */
export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-tier-low/40 bg-tier-low/10 px-4 py-3 text-sm text-tier-low"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="flex-1">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 underline underline-offset-2 hover:text-zinc-950">
          Try again
        </button>
      )}
    </div>
  );
}
