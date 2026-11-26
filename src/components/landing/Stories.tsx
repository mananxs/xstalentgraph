import { STORIES } from "./data";
import { Avatar, SectionHeader } from "./ui";

/** Monochrome wordmark: first letters in a square, so no third-party logo files are needed. */
function Mark({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900">
      <span aria-hidden="true" className="flex size-6 items-center justify-center rounded bg-zinc-900 text-[11px] text-white">
        {name[0]}
      </span>
      {name}
    </span>
  );
}

export function Stories() {
  return (
    <section id="stories" className="border-b border-zinc-200 bg-white py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader tag="[04] customer stories" title="Recruiting teams that stopped juggling tabs" />
        <ul className="mt-12 grid gap-4 md:grid-cols-3">
          {STORIES.map((story) => (
            <li key={story.org} className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-6">
              <Mark name={story.org} />
              <p className="mt-1 text-xs text-zinc-500">{story.kind}</p>
              <p className="mt-6 text-4xl font-semibold tabular-nums text-zinc-950">{story.metric}</p>
              <p className="text-xs text-zinc-600">{story.metricLabel}</p>
              <h3 className="mt-5 text-lg font-semibold leading-snug text-zinc-950">{story.headline}</h3>
              <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-zinc-600">&ldquo;{story.quote}&rdquo;</blockquote>
              <figcaption className="mt-5 flex items-center gap-2.5 border-t border-zinc-200 pt-4">
                <Avatar name={story.person} />
                <span className="text-xs">
                  <span className="block font-medium text-zinc-950">{story.person}</span>
                  <span className="text-zinc-600">{story.role}</span>
                </span>
              </figcaption>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
