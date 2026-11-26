"use client";

import {
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJobs } from "@/hooks/useJobs";
import { api, toMessage } from "@/lib/api";
import { getScoreTier } from "@/lib/score";
import type { JobDetailDto, ResumeDto, ResumeSkillDto } from "@/lib/types";
import { CardSkeleton } from "./CardSkeleton";
import { EmptyState } from "./EmptyState";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { ScoreFilter } from "./ScoreFilter";
import { ScoreRing } from "./ScoreRing";
import { SourcingDialog } from "./SourcingDialog";

interface UploadItem {
  key: string;
  file: File;
  state: "queued" | "working" | "done" | "error";
  message?: string;
}

const ACCEPT = ".pdf,.doc,.docx,.txt,.md,.rtf";
/** Resumes analysed at the same time (keeps the free AI tier happy). */
const UPLOAD_CONCURRENCY = 2;

/** Resume Match: upload resumes for a job, get a skill-by-skill ATS analysis, rank, shortlist and anonymize. */
export function ResumeMatch({ initialJobId }: { initialJobId: string | null }) {
  const jobsState = useJobs();
  const [pickedJobId, setPickedJobId] = useState<string | null>(initialJobId);
  const selected = jobsState.jobs.find((job) => job.id === pickedJobId) ?? jobsState.jobs[0] ?? null;
  const jobId = selected?.id ?? null;

  const [job, setJob] = useState<JobDetailDto | null>(null);
  const [resumes, setResumes] = useState<ResumeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [search, setSearch] = useState("");
  const [onlyShortlisted, setOnlyShortlisted] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newJobOpen, setNewJobOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const latestJob = useRef<string | null>(null);

  const load = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [jobResponse, resumeResponse] = await Promise.all([api.getJob(id), api.listResumes(id)]);
      if (latestJob.current !== id) return;
      setJob(jobResponse.job);
      setResumes(resumeResponse.resumes);
      setError(null);
    } catch (caught) {
      if (latestJob.current === id) setError(toMessage(caught));
    } finally {
      if (latestJob.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    latestJob.current = jobId;
    setJob(null);
    setResumes([]);
    setUploads([]);
    if (jobId) void load(jobId);
    else setLoading(false);
  }, [jobId, load]);

  /** Uploads one resume per request, a couple at a time; a failing file never stops the others. */
  async function addFiles(files: FileList | File[]) {
    if (!jobId) return;
    const items: UploadItem[] = [...files].map((file, index) => ({ key: `${Date.now()}-${index}-${file.name}`, file, state: "queued" }));
    if (items.length === 0) return;
    setUploads((current) => [...items, ...current].slice(0, 50));

    const queue = [...items];
    const targetJob = jobId;
    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const key = item.key;
        setUploads((current) => current.map((entry) => (entry.key === key ? { ...entry, state: "working" } : entry)));
        try {
          const { resume, notice } = await api.uploadResume(targetJob, item.file);
          setUploads((current) =>
            current.map((entry) => (entry.key === key ? { ...entry, state: "done", message: `${resume.score}%${notice ? " · Quick score" : ""}` } : entry)),
          );
          if (latestJob.current === targetJob) setResumes((current) => rank([...current, resume]));
        } catch (caught) {
          setUploads((current) => current.map((entry) => (entry.key === key ? { ...entry, state: "error", message: toMessage(caught) } : entry)));
        }
      }
    });
    await Promise.allSettled(workers);
  }

  async function toggleShortlist(resume: ResumeDto) {
    const next = !resume.shortlisted;
    setResumes((current) => current.map((item) => (item.id === resume.id ? { ...item, shortlisted: next } : item)));
    try {
      await api.updateResume(resume.id, { shortlisted: next });
    } catch (caught) {
      setResumes((current) => current.map((item) => (item.id === resume.id ? { ...item, shortlisted: !next } : item)));
      setError(toMessage(caught));
    }
  }

  async function remove(resume: ResumeDto) {
    if (!window.confirm(`Delete ${resume.label}'s resume and analysis?`)) return;
    try {
      await api.deleteResume(resume.id);
      setResumes((current) => current.filter((item) => item.id !== resume.id));
      if (openId === resume.id) setOpenId(null);
    } catch (caught) {
      setError(toMessage(caught));
    }
  }

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return resumes.filter(
      (resume) =>
        resume.score >= minScore &&
        (!onlyShortlisted || resume.shortlisted) &&
        (!query ||
          [resume.label, resume.fileName, resume.summary ?? "", ...resume.skills.filter((s) => s.status === "matched").map((s) => s.name)]
            .join(" ")
            .toLowerCase()
            .includes(query)),
    );
  }, [resumes, minScore, search, onlyShortlisted]);

  const opened = resumes.find((resume) => resume.id === openId) ?? null;
  const working = uploads.some((item) => item.state === "queued" || item.state === "working");

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-zinc-600">
            <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">Module</span>
            Resume Match · part of TalentGraph
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {jobsState.jobs.length > 0 ? (
              <>
                <label htmlFor="rm-job" className="sr-only">
                  Job
                </label>
                <select
                  id="rm-job"
                  value={jobId ?? ""}
                  onChange={(event) => setPickedJobId(event.target.value)}
                  className="max-w-full rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-xl font-semibold"
                >
                  {jobsState.jobs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <h1 className="text-2xl font-semibold">{jobsState.status === "loading" ? "Loading…" : "No jobs yet"}</h1>
            )}
            <button
              type="button"
              onClick={() => setNewJobOpen(true)}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-zinc-300 px-3 text-sm text-zinc-800 hover:border-accent/50 hover:text-zinc-950"
            >
              <Plus className="size-4" aria-hidden="true" /> New job from JD
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <MiniStat label="Analysed" value={resumes.length} />
          <MiniStat label="Shortlisted" value={resumes.filter((resume) => resume.shortlisted).length} />
          <MiniStat label="Best" value={resumes[0]?.score ?? "–"} />
        </div>
      </header>

      {(error ?? jobsState.error) && <ErrorBanner message={(error ?? jobsState.error) as string} onRetry={() => jobId && void load(jobId)} />}

      {job && (
        <section aria-label="Skill checklist" className="card-surface rounded-2xl border border-zinc-200 p-4">
          <p className="mb-2 text-xs text-zinc-600">
            Every resume is checked against this skill list
            {job.experienceYears ? ` · ${job.experienceYears}+ years required` : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {job.requiredSkills.map((skill) => (
              <span key={`r-${skill}`} className="rounded-full border border-tier-high/40 bg-tier-high/10 px-2.5 py-0.5 text-xs text-tier-high">
                {skill}
              </span>
            ))}
            {job.preferredSkills.map((skill) => (
              <span key={`p-${skill}`} className="rounded-full border border-dashed border-zinc-300 px-2.5 py-0.5 text-xs text-zinc-700">
                {skill} <span className="text-zinc-500">(preferred)</span>
              </span>
            ))}
            {job.requiredSkills.length + job.preferredSkills.length === 0 && (
              <span className="text-xs text-amber-700">This job has no skills listed: create a job from a JD so resumes can be scored.</span>
            )}
          </div>
        </section>
      )}

      {jobId && (
        <section aria-label="Upload resumes" className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void addFiles(event.dataTransfer.files);
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragging ? "border-accent bg-accent/10" : "border-zinc-200 hover:border-accent/50"
            }`}
          >
            <UploadCloud className="size-9 text-accent" aria-hidden="true" />
            <span className="font-medium text-zinc-950">Drop resumes here, or click to choose</span>
            <span className="text-xs text-zinc-500">PDF, DOC, DOCX or TXT · many at once · scanned PDFs are read with AI OCR</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <ul className="card-surface flex max-h-56 flex-col gap-1 overflow-y-auto rounded-2xl border border-zinc-200 p-3 text-sm" aria-live="polite">
            {uploads.length === 0 && <li className="p-2 text-xs text-zinc-500">Upload progress shows here.</li>}
            {uploads.map((item) => (
              <li key={item.key} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                {item.state === "working" || item.state === "queued" ? (
                  <Loader2 className={`size-4 shrink-0 ${item.state === "working" ? "animate-spin text-accent" : "text-zinc-400"}`} aria-hidden="true" />
                ) : item.state === "done" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-tier-high" aria-hidden="true" />
                ) : (
                  <XCircle className="size-4 shrink-0 text-tier-low" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-zinc-700" title={item.file.name}>
                  {item.file.name}
                </span>
                <span className={`max-w-[45%] truncate text-xs ${item.state === "error" ? "text-tier-low" : "text-zinc-500"}`} title={item.message}>
                  {item.state === "queued" ? "Waiting" : item.state === "working" ? "Analysing…" : item.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {jobId && resumes.length > 0 && (
        <section aria-label="Filters" className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, file or matched skill"
            className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-100 px-3 text-sm outline-none placeholder:text-zinc-500 focus:border-accent/60 lg:max-w-md"
          />
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={onlyShortlisted} onChange={(event) => setOnlyShortlisted(event.target.checked)} className="size-4 accent-[#1d4ed8]" />
              Shortlisted only
            </label>
            <ScoreFilter value={minScore} onChange={setMinScore} />
          </div>
        </section>
      )}

      <section aria-label="Ranked resumes">
        {loading || jobsState.status === "loading" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : !jobId ? (
          <EmptyState
            icon={<FileText className="size-8" aria-hidden="true" />}
            title="Create a job first"
            description="Paste or upload a JD. Its skills become the checklist every resume is scored against."
            actionLabel="New job from JD"
            onAction={() => setNewJobOpen(true)}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-8" aria-hidden="true" />}
            title={resumes.length ? "No resumes match your filters" : "No resumes analysed yet"}
            description={resumes.length ? "Clear the search or lower the minimum score." : "Upload resumes above. Each one is ranked by skill coverage and experience."}
          />
        ) : (
          <ol className="flex flex-col gap-3">
            {visible.map((resume) => (
              <ResumeRow
                key={resume.id}
                resume={resume}
                rank={resumes.indexOf(resume) + 1}
                onOpen={() => setOpenId(resume.id)}
                onShortlist={() => void toggleShortlist(resume)}
                onDelete={() => void remove(resume)}
              />
            ))}
          </ol>
        )}
      </section>

      {working && <p className="text-center text-xs text-zinc-500">You can keep working while resumes are analysed.</p>}

      <ResumeDetail
        resume={opened}
        onClose={() => setOpenId(null)}
        onChange={(updated) => setResumes((current) => rank(current.map((item) => (item.id === updated.id ? updated : item))))}
      />

      <SourcingDialog
        open={newJobOpen}
        onClose={() => setNewJobOpen(false)}
        purpose="create"
        onJobCreated={async (created) => {
          await jobsState.reload();
          setPickedJobId(created.id);
        }}
      />
    </div>
  );
}

/** Same ranking as the server: score, then required skills covered, then total matched. */
function rank(resumes: ResumeDto[]): ResumeDto[] {
  const matched = (resume: ResumeDto) => resume.skills.filter((skill) => skill.status === "matched").length;
  return [...resumes].sort((a, b) => b.score - a.score || b.reqHit - a.reqHit || matched(b) - matched(a));
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card-surface rounded-xl border border-zinc-200 px-4 py-2">
      <p className="text-lg font-semibold tabular-nums text-zinc-950">{value}</p>
      <p className="text-[11px] text-zinc-500">{label}</p>
    </div>
  );
}

function ResumeRow({ resume, rank: position, onOpen, onShortlist, onDelete }: { resume: ResumeDto; rank: number; onOpen: () => void; onShortlist: () => void; onDelete: () => void }) {
  const matched = resume.skills.filter((skill) => skill.status === "matched");
  const missingRequired = resume.skills.filter((skill) => skill.status === "missing" && skill.type === "required");
  const shortfall = resume.requiredYears && resume.candidateYears !== null && resume.candidateYears < resume.requiredYears;

  return (
    <li
      className={`card-surface flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${
        resume.shortlisted ? "border-accent/60" : "border-zinc-200"
      }`}
    >
      <div className="flex items-center gap-4">
        <span className="w-6 text-center text-sm tabular-nums text-zinc-500">#{position}</span>
        <ScoreRing score={resume.score} size={56} />
      </div>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-zinc-950">{resume.label}</span>
          <span className="text-xs text-zinc-500">{resume.code}</span>
          {resume.scoredBy === "quick" ? (
            <span className="flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
              <Zap className="size-2.5" aria-hidden="true" /> Quick
            </span>
          ) : (
            <span className="flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
              <Sparkles className="size-2.5" aria-hidden="true" /> AI
            </span>
          )}
          {resume.maskStatus === "masked" && (
            <span className="flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
              <ShieldCheck className="size-2.5" aria-hidden="true" /> Anonymized
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">{resume.fileName}</p>
        <p className="mt-1.5 text-xs text-zinc-600">
          Required {formatHit(resume.reqHit)}/{resume.reqTotal}
          {" · "}
          {matched.length} matched
          {resume.candidateYears !== null && (
            <span className={shortfall ? "text-amber-700" : ""}>
              {" · "}
              {resume.candidateYears} yrs{resume.requiredYears ? ` (needs ${resume.requiredYears})` : ""}
            </span>
          )}
        </p>
        {missingRequired.length > 0 && (
          <p className="mt-1 truncate text-xs text-tier-low">Missing: {missingRequired.map((skill) => skill.name).join(", ")}</p>
        )}
      </button>
      <div className="flex items-center gap-2 self-end sm:self-center">
        <button type="button" onClick={onOpen} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:border-zinc-300 hover:text-zinc-950">
          Details
        </button>
        <button
          type="button"
          aria-pressed={resume.shortlisted}
          onClick={onShortlist}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
            resume.shortlisted ? "border-accent/60 bg-accent/10 text-accent" : "border-zinc-200 text-zinc-700 hover:border-zinc-300 hover:text-zinc-950"
          }`}
        >
          {resume.shortlisted ? <BookmarkCheck className="size-4" aria-hidden="true" /> : <Bookmark className="size-4" aria-hidden="true" />}
          {resume.shortlisted ? "Shortlisted" : "Shortlist"}
        </button>
        <button type="button" onClick={onDelete} aria-label={`Delete ${resume.label}`} className="rounded-lg p-2 text-zinc-500 hover:bg-tier-low/10 hover:text-tier-low">
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

const formatHit = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

const STATUS_STYLE: Record<ResumeSkillDto["status"], string> = {
  matched: "border-tier-high/40 bg-tier-high/10 text-tier-high",
  partial: "border-tier-mid/40 bg-tier-mid/10 text-tier-mid",
  missing: "border-dashed border-tier-low/60 text-tier-low",
};

function ResumeDetail({ resume, onClose, onChange }: { resume: ResumeDto | null; onClose: () => void; onChange: (resume: ResumeDto) => void }) {
  const [masked, setMasked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<null | "loading" | "masking" | "saving">(null);
  const [error, setError] = useState<string | null>(null);
  const resumeId = resume?.id ?? null;

  useEffect(() => {
    setMasked(null);
    setError(null);
    if (!resumeId) return;
    let cancelled = false;
    setBusy("loading");
    api
      .getResume(resumeId)
      .then((response) => {
        if (cancelled) return;
        setMasked(response.maskedText);
        setDraft(response.maskedText ?? "");
      })
      .catch((caught: unknown) => !cancelled && setError(toMessage(caught)))
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  if (!resume) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  async function mask() {
    if (!resume) return;
    setBusy("masking");
    setError(null);
    try {
      const response = await api.maskResume(resume.id);
      onChange(response.resume);
      setMasked(response.maskedText);
      setDraft(response.maskedText ?? "");
      if (response.resume.maskStatus === "failed") setError(response.resume.maskError ?? "Masking failed.");
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveMasked() {
    if (!resume) return;
    setBusy("saving");
    try {
      const response = await api.updateResume(resume.id, { maskedText: draft });
      onChange(response.resume);
      setMasked(draft);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const tier = getScoreTier(resume.score);
  const groups: Array<{ title: string; skills: ResumeSkillDto[] }> = [
    { title: "Required", skills: resume.skills.filter((skill) => skill.type === "required") },
    { title: "Preferred", skills: resume.skills.filter((skill) => skill.type === "preferred") },
    { title: "Other tools", skills: resume.skills.filter((skill) => skill.type === "other") },
  ].filter((group) => group.skills.length > 0);

  return (
    <Modal open onClose={onClose} busy={busy === "masking" || busy === "saving"} title={`${resume.label} · ${resume.code}`} description={resume.fileName} widthClass="max-w-3xl">
      <div className="flex flex-col gap-5">
        {error && <ErrorBanner message={error} />}
        <div className="flex items-center gap-4">
          <ScoreRing score={resume.score} size={72} />
          <div className="min-w-0">
            <p className="font-medium" style={{ color: tier.color }}>
              {tier.label} · {resume.scoredBy === "quick" ? "Quick score (keyword check)" : `AI analysis (${resume.model})`}
            </p>
            {resume.summary && <p className="mt-1 text-sm text-zinc-700">{resume.summary}</p>}
            <p className="mt-1 text-xs text-zinc-500">
              Required skills {formatHit(resume.reqHit)}/{resume.reqTotal}
              {resume.candidateYears !== null ? ` · ${resume.candidateYears} years relevant experience` : ""}
              {resume.requiredYears ? ` · job needs ${resume.requiredYears}` : ""}
            </p>
          </div>
        </div>

        {groups.map((group) => (
          <div key={group.title}>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">{group.title}</p>
            <ul className="flex flex-col gap-1.5">
              {group.skills.map((skill) => (
                <li key={skill.name} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <span className={`w-fit shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${STATUS_STYLE[skill.status]}`}>
                    {skill.name}
                    {skill.status === "partial" ? " (partial)" : ""}
                  </span>
                  {skill.handsOn && (
                    <span className={`w-fit text-[11px] ${skill.handsOnShown ? "text-tier-high" : "text-amber-700"}`}>
                      {skill.handsOnShown ? "hands-on shown" : "hands-on not shown"}
                    </span>
                  )}
                  <span className="text-xs text-zinc-600">{skill.evidence || (skill.status === "missing" ? "No evidence in the resume" : "")}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium text-zinc-950">
              <ShieldCheck className="size-4 text-emerald-700" aria-hidden="true" /> Anonymized resume
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void mask()}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy === "masking" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
                {masked ? "Re-create" : "Anonymize"}
              </button>
              <a href={`/api/resumes/${resume.id}/file`} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:text-zinc-950">
                <Download className="size-4" aria-hidden="true" /> Original
              </a>
            </div>
          </div>
          {busy === "loading" && <p className="mt-3 text-xs text-zinc-500">Loading…</p>}
          {masked !== null && (
            <>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={10}
                aria-label="Anonymized resume text"
                className="mt-3 w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-800 outline-none focus:border-accent/60"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveMasked()}
                  disabled={busy !== null || draft === masked}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-800 hover:border-zinc-300 disabled:opacity-40"
                >
                  {busy === "saving" ? "Saving…" : "Save edits"}
                </button>
                <a href={`/api/resumes/${resume.id}/masked.pdf`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:text-zinc-950">
                  <Eye className="size-4" aria-hidden="true" /> Preview PDF
                </a>
                <a href={`/api/resumes/${resume.id}/masked.pdf?download=1`} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:text-zinc-950">
                  <Download className="size-4" aria-hidden="true" /> PDF with watermark
                </a>
                <a href={`/api/resumes/${resume.id}/masked.pdf?download=1&wm=0`} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:text-zinc-950">
                  <Download className="size-4" aria-hidden="true" /> PDF without
                </a>
              </div>
            </>
          )}
          {masked === null && busy !== "loading" && (
            <p className="mt-2 text-xs text-zinc-500">Removes name, contact details, links and the current employer, then builds a clean PDF to share with clients.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
