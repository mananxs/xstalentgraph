"use client";

import { ClipboardPaste, FileUp, Loader2, Search, Settings2, Sparkles, UploadCloud, Wifi } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSourceName } from "@/hooks/useSourceName";
import { api, toMessage } from "@/lib/api";
import type { JdExtractionDto, JobDetailDto, JobDraft } from "@/lib/types";
import { ChipInput } from "./ChipInput";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { SourceToggle } from "./SourceToggle";

type Mode = "current" | "paste" | "upload";

interface SourcingDialogProps {
  open: boolean;
  onClose: () => void;
  /** "sourcing" = Find candidates (search GitHub afterwards). "create" = only create a job (Resume Match). */
  purpose: "sourcing" | "create";
  /** The selected job ("current settings"). Not used in create mode. */
  jobId?: string | null;
  /** Search GitHub with the current job's settings. */
  onSearchCurrent?: (options?: { maxProfiles?: number }) => Promise<void> | void;
  /** The job was edited and saved from the "current settings" tab. */
  onJobUpdated?: () => void;
  /** A job was created from a JD. `search` = the caller should start a GitHub search for it. */
  onJobCreated: (job: JobDetailDto, search: boolean) => Promise<void> | void;
}

const LANGUAGE_SUGGESTIONS = ["Python", "JavaScript", "TypeScript", "Java", "Go", "C#", "C++", "Ruby", "PHP", "Kotlin", "Swift", "Rust"];
const ACCEPT = ".pdf,.doc,.docx,.txt,.md,.rtf";

/** Find candidates: with the job's current settings, a pasted JD, or an uploaded JD file (PDF / DOC / DOCX / TXT). */
export function SourcingDialog({ open, onClose, purpose, jobId, onSearchCurrent, onJobUpdated, onJobCreated }: SourcingDialogProps) {
  const source = useSourceName();
  const [mode, setMode] = useState<Mode>(purpose === "sourcing" ? "current" : "paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<JdExtractionDto | null>(null);
  const [draft, setDraft] = useState<JobDraft | null>(null);
  const [job, setJob] = useState<JobDetailDto | null>(null);
  /** The editable copy of the selected job ("current settings" tab) and how many profiles this run should find. */
  const [edit, setEdit] = useState<JobDraft | null>(null);
  const [maxProfiles, setMaxProfiles] = useState(30);
  const [busy, setBusy] = useState<null | "reading" | "saving" | "starting">(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Reset every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setMode(purpose === "sourcing" ? "current" : "paste");
    setText("");
    setFile(null);
    setExtraction(null);
    setDraft(null);
    setError(null);
    setBusy(null);
  }, [open, purpose]);

  // Load the current job's settings for the "current settings" tab.
  useEffect(() => {
    if (!open || purpose !== "sourcing" || !jobId) return;
    let cancelled = false;
    setJob(null);
    api
      .getJob(jobId)
      .then((response) => {
        if (cancelled) return;
        setJob(response.job);
        setEdit(toDraft(response.job));
      })
      .catch((caught: unknown) => !cancelled && setError(toMessage(caught)));
    return () => {
      cancelled = true;
    };
  }, [open, purpose, jobId]);

  async function readJd() {
    setError(null);
    setBusy("reading");
    try {
      const result = mode === "upload" && file ? await api.extractJd({ file }) : await api.extractJd({ text });
      setExtraction(result);
      setDraft(result.draft);
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function createJob(search: boolean) {
    if (!draft || !extraction) return;
    if (draft.languages.length === 0 && draft.locations.length === 0) {
      setError(`Add at least one programming language or location, so ${source.name} knows where to look.`);
      return;
    }
    setError(null);
    setBusy("saving");
    try {
      const { job: created } = await api.createJob({
        ...draft,
        source: extraction.source,
        sourceFileName: extraction.fileName,
        rawText: extraction.rawText,
      });
      setBusy("starting");
      await onJobCreated(created, search);
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const dirty = job !== null && edit !== null && JSON.stringify(toDraft(job)) !== JSON.stringify(edit);

  /** Saves the edited job. Returns false (and shows the problem) when it could not be saved. */
  async function saveEdits(): Promise<boolean> {
    if (!job || !edit) return false;
    if (edit.title.trim().length < 2) {
      setError("Give the job a title.");
      return false;
    }
    try {
      const { job: saved } = await api.updateJob(job.id, edit);
      setJob(saved);
      setEdit(toDraft(saved));
      onJobUpdated?.();
      return true;
    } catch (caught) {
      setError(toMessage(caught));
      return false;
    }
  }

  async function saveOnly() {
    setBusy("saving");
    setError(null);
    await saveEdits();
    setBusy(null);
  }

  /** Saves any edits first, so the run always searches with what is on screen. */
  async function searchCurrent() {
    setBusy("starting");
    setError(null);
    try {
      if (dirty && !(await saveEdits())) return;
      await onSearchCurrent?.({ maxProfiles });
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const tabs: Array<{ id: Mode; label: string; icon: ReactNode }> = [
    ...(purpose === "sourcing" ? [{ id: "current" as const, label: "Current job settings", icon: <Settings2 className="size-4" aria-hidden="true" /> }] : []),
    { id: "paste", label: "Paste JD text", icon: <ClipboardPaste className="size-4" aria-hidden="true" /> },
    { id: "upload", label: "Upload JD (PDF / DOC)", icon: <FileUp className="size-4" aria-hidden="true" /> },
  ];

  const reviewing = draft !== null && mode !== "current";

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy !== null}
      title={purpose === "sourcing" ? "Find candidates" : "New job from a JD"}
      description={
        purpose === "sourcing"
          ? `Choose what to search ${source.name} with. The 10 best-matching candidates are shown.`
          : "Paste or upload a job description. Its skills become the checklist every resume is scored against."
      }
      widthClass="max-w-3xl"
    >
      {purpose === "sourcing" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-zinc-600">Search on</span>
          <SourceToggle disabled={busy !== null} />
        </div>
      )}

      {!reviewing && (
        <div role="tablist" aria-label="Search source" className="mb-5 grid gap-2 sm:grid-cols-3">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={mode === tab.id}
              onClick={() => {
                setMode(tab.id);
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                mode === tab.id
                  ? "border-accent/60 bg-accent/10 text-zinc-950"
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-zinc-800"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {/* ---------- current settings ---------- */}
      {mode === "current" && (
        <div className="flex flex-col gap-4">
          {!job || !edit ? (
            <div className="flex items-center gap-2 text-sm text-zinc-600">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading job settings…
            </div>
          ) : (
            <>
              <p className="text-xs text-zinc-600">
                Everything below can be changed after the job was created. The next search uses exactly what you see here, and the AI
                judges candidates against the description.
              </p>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <label htmlFor="edit-title" className="mb-1.5 block text-xs font-medium text-zinc-600">
                  Job title
                </label>
                <input
                  id="edit-title"
                  value={edit.title}
                  onChange={(event) => setEdit({ ...edit, title: event.target.value })}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 outline-none focus:border-accent/60"
                />

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <ChipInput label="Required skills" values={edit.requiredSkills} onChange={(requiredSkills) => setEdit({ ...edit, requiredSkills })} />
                  <ChipInput label="Preferred skills" values={edit.preferredSkills} onChange={(preferredSkills) => setEdit({ ...edit, preferredSkills })} />
                  <ChipInput
                    label={source.linkedin ? "Languages" : "GitHub languages"}
                    values={edit.languages}
                    onChange={(languages) => setEdit({ ...edit, languages })}
                    suggestions={LANGUAGE_SUGGESTIONS}
                    placeholder="e.g. Python"
                  />
                  <ChipInput
                    label="Locations"
                    values={edit.locations}
                    onChange={(locations) => setEdit({ ...edit, locations })}
                    placeholder="e.g. Pune"
                    hint="LinkedIn search covers Bangalore, Pune, Delhi NCR, Mumbai, Hyderabad, Chennai and Jaipur; your cities go first."
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                  <label className="flex items-center gap-2 text-zinc-700">
                    Seniority
                    <input
                      value={edit.seniority ?? ""}
                      onChange={(event) => setEdit({ ...edit, seniority: event.target.value.trim() === "" ? null : event.target.value })}
                      placeholder="e.g. Senior"
                      className="h-8 w-28 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-zinc-950 outline-none focus:border-accent/60"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-zinc-700">
                    Min. experience
                    <input
                      type="number"
                      min={0}
                      max={40}
                      value={edit.experienceYears ?? ""}
                      onChange={(event) => setEdit({ ...edit, experienceYears: event.target.value === "" ? null : Number(event.target.value) })}
                      className="h-8 w-16 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-zinc-950 outline-none focus:border-accent/60"
                    />
                    years
                  </label>
                  <label className="flex items-center gap-2 text-zinc-700">
                    <input
                      type="checkbox"
                      checked={edit.remoteAllowed}
                      onChange={(event) => setEdit({ ...edit, remoteAllowed: event.target.checked })}
                      className="size-4 accent-[#1d4ed8]"
                    />
                    <Wifi className="size-3.5" aria-hidden="true" /> Remote allowed
                  </label>
                </div>

                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-600 hover:text-zinc-800">Job description (read by the AI)</summary>
                  <textarea
                    value={edit.description}
                    onChange={(event) => setEdit({ ...edit, description: event.target.value })}
                    rows={8}
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-950 outline-none focus:border-accent/60"
                  />
                </details>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  Profiles to find
                  <input
                    type="number"
                    min={10}
                    max={200}
                    step={10}
                    value={maxProfiles}
                    onChange={(event) => setMaxProfiles(Math.min(200, Math.max(10, Number(event.target.value) || 30)))}
                    className="h-8 w-20 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-zinc-950 outline-none focus:border-accent/60"
                  />
                  <span className="text-xs text-zinc-500">max 200</span>
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {dirty && (
                    <button
                      type="button"
                      onClick={() => void saveOnly()}
                      disabled={busy !== null}
                      className="rounded-xl border border-zinc-300 px-4 py-2 text-sm text-zinc-800 hover:border-zinc-300 disabled:opacity-50"
                    >
                      {busy === "saving" ? "Saving…" : "Save changes"}
                    </button>
                  )}
                  <PrimaryButton onClick={() => void searchCurrent()} busy={busy === "starting"} icon={<Search className="size-4" aria-hidden="true" />}>
                    {dirty ? `Save & search ${source.name}` : `Search ${source.name}`}
                  </PrimaryButton>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------- paste ---------- */}
      {mode === "paste" && !reviewing && (
        <div className="flex flex-col gap-3">
          <label htmlFor="jd-text" className="text-xs font-medium text-zinc-600">
            Job description
          </label>
          <textarea
            id="jd-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={11}
            placeholder={"Paste the full JD here.\n\nExample: Senior Backend Engineer, Bengaluru (Hybrid). 5+ years with Python, Django, PostgreSQL. Nice to have: AWS, Docker…"}
            className="w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-accent/60"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-500">{text.trim().length} characters</span>
            <PrimaryButton
              onClick={() => void readJd()}
              disabled={text.trim().length < 40}
              busy={busy === "reading"}
              icon={<Sparkles className="size-4" aria-hidden="true" />}
            >
              Read JD
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* ---------- upload ---------- */}
      {mode === "upload" && !reviewing && (
        <div className="flex flex-col gap-3">
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
              const dropped = event.dataTransfer.files[0];
              if (dropped) setFile(dropped);
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragging ? "border-accent bg-accent/10" : "border-zinc-200 hover:border-accent/50"
            }`}
          >
            <UploadCloud className="size-8 text-accent" aria-hidden="true" />
            <span className="text-sm text-zinc-950">{file ? file.name : "Drop the JD here, or click to choose"}</span>
            <span className="text-xs text-zinc-500">PDF, DOC, DOCX or TXT, up to 10 MB. Scanned PDFs are read with AI OCR.</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <div className="flex justify-end">
            <PrimaryButton onClick={() => void readJd()} disabled={!file} busy={busy === "reading"} icon={<Sparkles className="size-4" aria-hidden="true" />}>
              Read JD
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* ---------- review the extracted job ---------- */}
      {reviewing && draft && extraction && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-accent/10 px-2.5 py-1 text-accent">
              {extraction.extractedBy === "heuristic" ? "Read with the offline parser" : `Read by AI (${extraction.extractedBy})`}
            </span>
            {extraction.fileName && <span className="text-zinc-500">{extraction.fileName}</span>}
          </div>
          {extraction.notice && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{extraction.notice}</p>}

          <div>
            <label htmlFor="draft-title" className="mb-1.5 block text-xs font-medium text-zinc-600">
              Job title
            </label>
            <input
              id="draft-title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-950 outline-none focus:border-accent/60"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ChipInput
              label={source.linkedin ? "Languages (search filter)" : "GitHub languages (search filter)"}
              values={draft.languages}
              onChange={(languages) => setDraft({ ...draft, languages })}
              suggestions={LANGUAGE_SUGGESTIONS}
              placeholder="e.g. Python"
            />
            <ChipInput
              label={source.linkedin ? "Locations" : "Locations (one GitHub search each)"}
              values={draft.locations}
              onChange={(locations) => setDraft({ ...draft, locations })}
              placeholder="e.g. Bengaluru"
              hint="City names work best."
            />
            <ChipInput label="Required skills" values={draft.requiredSkills} onChange={(requiredSkills) => setDraft({ ...draft, requiredSkills })} />
            <ChipInput label="Preferred skills" values={draft.preferredSkills} onChange={(preferredSkills) => setDraft({ ...draft, preferredSkills })} />
          </div>
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <label className="flex items-center gap-2 text-zinc-700">
              <input
                type="checkbox"
                checked={draft.remoteAllowed}
                onChange={(event) => setDraft({ ...draft, remoteAllowed: event.target.checked })}
                className="size-4 accent-[#1d4ed8]"
              />
              Remote allowed
            </label>
            <label className="flex items-center gap-2 text-zinc-700">
              Min. experience
              <input
                type="number"
                min={0}
                max={40}
                value={draft.experienceYears ?? ""}
                onChange={(event) => setDraft({ ...draft, experienceYears: event.target.value === "" ? null : Number(event.target.value) })}
                className="h-8 w-16 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-zinc-950 outline-none focus:border-accent/60"
              />
              years
            </label>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 pt-4 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setExtraction(null);
              }}
              disabled={busy !== null}
              className="rounded-lg px-3 py-2 text-sm text-zinc-600 hover:text-zinc-950 disabled:opacity-50"
            >
              Back
            </button>
            <div className="flex flex-col gap-2 sm:flex-row">
              {purpose === "sourcing" && (
                <button
                  type="button"
                  onClick={() => void createJob(false)}
                  disabled={busy !== null}
                  className="rounded-xl border border-zinc-300 px-4 py-2 text-sm text-zinc-800 hover:border-zinc-300 disabled:opacity-50"
                >
                  Save job only
                </button>
              )}
              <PrimaryButton
                onClick={() => void createJob(purpose === "sourcing")}
                busy={busy === "saving" || busy === "starting"}
                icon={purpose === "sourcing" ? <Search className="size-4" aria-hidden="true" /> : undefined}
              >
                {purpose === "sourcing" ? `Create job & search ${source.name}` : "Create job"}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The editable fields of a job (what PATCH /api/jobs/:id accepts). */
function toDraft(job: JobDetailDto): JobDraft {
  return {
    title: job.title,
    description: job.description,
    requiredSkills: job.requiredSkills,
    preferredSkills: job.preferredSkills,
    technologies: job.technologies,
    handsOn: job.handsOn,
    languages: job.languages,
    locations: job.locations,
    remoteAllowed: job.remoteAllowed,
    experienceYears: job.experienceYears,
    seniority: job.seniority,
    workMode: job.workMode,
    employmentType: job.employmentType,
  };
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
  icon,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
