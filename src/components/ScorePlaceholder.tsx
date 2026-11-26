import { Loader2, Minus } from "lucide-react";

interface ScorePlaceholderProps {
  /** pending = Gemini is working on it, failed = it could not be scored. */
  status: "pending" | "failed";
  /** Width and height in pixels. Default 64 (same as ScoreRing). */
  size?: number;
}

/** Stands in for the score ring until a candidate has a score. */
export function ScorePlaceholder({ status, size = 64 }: ScorePlaceholderProps) {
  const isPending = status === "pending";

  return (
    <div
      role="img"
      aria-label={isPending ? "Score is being calculated" : "Could not be scored"}
      className={`flex shrink-0 flex-col items-center justify-center rounded-full border-2 border-dashed text-xs ${
        isPending ? "border-zinc-300 text-zinc-600" : "border-tier-low/50 text-tier-low"
      }`}
      style={{ width: size, height: size }}
    >
      {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Minus className="size-4" aria-hidden="true" />}
      <span aria-hidden="true">{isPending ? "Scoring" : "Failed"}</span>
    </div>
  );
}
