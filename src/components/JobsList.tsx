"use client";

import { Briefcase, FileSearch, LayoutDashboard, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useJobs } from "@/hooks/useJobs";
import { api, toMessage } from "@/lib/api";
import { CardSkeleton } from "./CardSkeleton";
import { EmptyState } from "./EmptyState";
import { ErrorBanner } from "./ErrorBanner";
import { SourcingDialog } from "./SourcingDialog";

/** All jobs of the organization, each linking to its GitHub pipeline and its Resume Match. */
export function JobsList() {
  const { jobs, status, error, reload } = useJobs();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const router = useRouter();
  const manyOwners = new Set(jobs.map((j) => j.ownerId)).size > 1; // admins and managers see every HR's jobs: label whose is whose

  async function remove(id: string, title: string) {
    if (!window.confirm(`Delete "${title}" with all its candidates and resumes?`)) return;
    try {
      await api.deleteJob(id);
      await reload();
    } catch (caught) {
      setActionError(toMessage(caught));
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Jobs</h1>
          <p className="mt-1 text-sm text-zinc-600">Each job powers candidate sourcing and Resume Match.</p>
        </div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="size-4" aria-hidden="true" /> New job from JD
        </button>
      </header>

      {(error ?? actionError) && <ErrorBanner message={(error ?? actionError) as string} onRetry={() => void reload()} />}

      {status === "loading" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {status === "ready" && jobs.length === 0 && (
        <EmptyState
          icon={<Briefcase className="size-8" aria-hidden="true" />}
          title="No jobs yet"
          description="Paste or upload a job description to create your first job."
          actionLabel="New job from JD"
          onAction={() => setDialogOpen(true)}
        />
      )}

      {jobs.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {jobs.map((job) => (
            <li key={job.id} className="card-surface flex h-full flex-col gap-2 rounded-2xl border border-zinc-200 p-5 transition-colors hover:border-accent/30">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-zinc-950">{job.title}</span>
                <button
                  type="button"
                  onClick={() => void remove(job.id, job.title)}
                  aria-label={`Delete ${job.title}`}
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-tier-low/10 hover:text-tier-low"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
              <span className="text-sm text-zinc-600">
                {job.matchCount} scored {job.matchCount === 1 ? "candidate" : "candidates"} · created {new Date(job.createdAt).toLocaleDateString()}
                {manyOwners && job.ownerName && <> · by <b className="font-medium text-zinc-800">{job.ownerName}</b></>}
              </span>
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                <Link href={`/jobs/${job.id}`} className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-sm text-accent hover:bg-accent/15">
                  <LayoutDashboard className="size-4" aria-hidden="true" /> Pipeline
                </Link>
                <Link
                  href={`/resume-match?job=${job.id}`}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:border-zinc-300 hover:text-zinc-950"
                >
                  <FileSearch className="size-4" aria-hidden="true" /> Resume Match
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SourcingDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        purpose="create"
        onJobCreated={async (job) => {
          await reload();
          router.push(`/jobs/${job.id}`);
        }}
      />
    </div>
  );
}
