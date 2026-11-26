"use client";

import { Bookmark, ExternalLink, FileText, MapPin } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, toMessage, type ShortlistsResponse } from "@/lib/api";
import { INTEGRATION_LOGOS } from "./BrandLogos";
import { CardSkeleton } from "./CardSkeleton";
import { EmptyState } from "./EmptyState";
import { ErrorBanner } from "./ErrorBanner";
import { ScoreRing } from "./ScoreRing";

/** Everyone shortlisted, across all jobs and both sources (GitHub sourcing + Resume Match). */
export function ShortlistsView() {
  const [data, setData] = useState<ShortlistsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .listShortlists()
      .then(setData)
      .catch((caught: unknown) => setError(toMessage(caught)));
  };
  useEffect(load, []);

  const empty = data && data.github.length === 0 && data.resumes.length === 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold">Shortlists</h1>
        <p className="mt-1 text-sm text-zinc-600">Everyone you shortlisted, from Naukri, LinkedIn, Cutshort, GitHub and uploaded resumes, in one list.</p>
      </header>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error && (
        <div className="grid gap-4 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}
      {empty && (
        <EmptyState
          icon={<Bookmark className="size-8" aria-hidden="true" />}
          title="Nobody shortlisted yet"
          description="Press Shortlist on a GitHub candidate in the Pipeline, or on a resume in Resume Match."
        />
      )}

      {data && data.github.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-700">
            Sourced candidates ({data.github.length})
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.github.map((row) => {
              const Logo = INTEGRATION_LOGOS[row.source];
              return (
              <li key={row.id} className="card-surface flex items-center gap-3 rounded-xl border border-zinc-200 p-4">
                {row.avatarUrl ? (
                  <img src={row.avatarUrl} alt="" width={40} height={40} className="size-10 rounded-full bg-zinc-100" loading="lazy" />
                ) : (
                  <div className="size-10 rounded-full bg-zinc-100" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-medium text-zinc-950">
                    <Logo size={14} />
                    <span className="truncate">{row.name ?? row.login}</span>
                  </p>
                  {row.headline && <p className="truncate text-xs text-zinc-600">{row.headline}</p>}
                  <Link href={`/pipeline?job=${row.jobId}`} className="block truncate text-xs text-accent hover:underline">
                    {row.jobTitle}
                  </Link>
                  {row.location && (
                    <p className="flex items-center gap-1 truncate text-xs text-zinc-500">
                      <MapPin className="size-3" aria-hidden="true" />
                      {row.location}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-center gap-1">
                  {row.score !== null && <ScoreRing score={row.score} size={44} />}
                  {row.source === "naukri" ? (
                    <Link
                      href={`/candidates/${row.candidateId}?job=${row.jobId}`}
                      aria-label={`Resume of ${row.name ?? row.login}`}
                      title={row.hasResume ? "Open the stored resume" : "Resume not captured yet"}
                      className={row.hasResume ? "text-accent hover:text-accent-strong" : "text-zinc-400 hover:text-zinc-700"}
                    >
                      <FileText className="size-4" aria-hidden="true" />
                    </Link>
                  ) : (
                    <a href={row.profileUrl} target="_blank" rel="noopener noreferrer" aria-label={`${row.login} profile`} className="text-zinc-600 hover:text-zinc-950">
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
        </section>
      )}

      {data && data.resumes.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-700">
            <FileText className="size-4 text-accent" aria-hidden="true" /> Resumes ({data.resumes.length})
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.resumes.map((row) => (
              <li key={row.id} className="card-surface flex items-center gap-3 rounded-2xl border border-zinc-200 p-4">
                <ScoreRing score={row.score} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-zinc-950">
                    {row.label} <span className="text-xs text-zinc-500">{row.code}</span>
                  </p>
                  <Link href={`/resume-match?job=${row.jobId}`} className="block truncate text-xs text-accent hover:underline">
                    {row.jobTitle}
                  </Link>
                  <p className="truncate text-xs text-zinc-500">{row.fileName}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
