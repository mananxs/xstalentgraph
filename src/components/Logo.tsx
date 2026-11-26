import { Network } from "lucide-react";

/** Wordmark: a square mark plus the product name. `compact` hides the name on small screens. */
export function Logo({ showName = true, alwaysShowName = false }: { showName?: boolean; alwaysShowName?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-white">
        <Network className="size-4" aria-hidden="true" />
      </span>
      {showName && <span className={`${alwaysShowName ? "block" : "hidden md:block"} text-[15px] font-semibold tracking-tight text-zinc-950`}>TalentGraph</span>}
    </span>
  );
}
