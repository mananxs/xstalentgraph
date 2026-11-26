/** Grey placeholder shaped like a candidate card, shown while data loads. */
export function CardSkeleton() {
  return (
    <div aria-hidden="true" className="card-surface animate-pulse rounded-2xl border border-zinc-200 p-5">
      <div className="flex items-start gap-3">
        <div className="size-12 rounded-full bg-zinc-100" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded bg-zinc-100" />
          <div className="h-3 w-1/3 rounded bg-zinc-100" />
        </div>
        <div className="size-16 rounded-full bg-zinc-100" />
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full rounded bg-zinc-100" />
        <div className="h-3 w-4/5 rounded bg-zinc-100" />
      </div>
      <div className="mt-5 flex gap-2">
        <div className="h-5 w-16 rounded-full bg-zinc-100" />
        <div className="h-5 w-20 rounded-full bg-zinc-100" />
        <div className="h-5 w-14 rounded-full bg-zinc-100" />
      </div>
      <div className="mt-6 flex justify-between">
        <div className="h-4 w-24 rounded bg-zinc-100" />
        <div className="h-8 w-24 rounded-lg bg-zinc-100" />
      </div>
    </div>
  );
}
