import { ArrowLeft, Download, FileText, FileWarning, Mail, MapPin, Phone, Timer } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScoreRing } from "@/components/ScoreRing";
import { SkillPills } from "@/components/SkillPills";
import { INTEGRATION_LOGOS } from "@/components/BrandLogos";
import { requireRecruiter } from "@/server/auth";
import { prisma } from "@/server/db";
import { uuidSchema } from "@/server/api/guards";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ job?: string }> };

const SOURCE_LABEL = { naukri: "Naukri", linkedin: "LinkedIn", cutshort: "Cutshort", github: "GitHub" } as const;

/** One candidate with the resume stored inside the platform (never a link out to Naukri). */
export default async function CandidatePage({ params, searchParams }: PageProps) {
  const recruiter = await requireRecruiter();
  const { id: rawId } = await params;
  const { job: rawJob } = await searchParams;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();

  const candidate = await prisma.candidate.findFirst({
    where: { id: id.data, matchScores: { some: { job: { organizationId: recruiter.organizationId } } } },
    select: {
      id: true,
      source: true,
      name: true,
      login: true,
      headline: true,
      location: true,
      experienceYears: true,
      ctc: true,
      noticePeriod: true,
      emails: true,
      phoneNumbers: true,
      profileUrl: true,
      skills: true,
      resumeFileName: true,
      resumeFileType: true,
      resumeText: true,
      resumeCapturedAt: true,
      resumeData: false,
      matchScores: {
        where: { job: { organizationId: recruiter.organizationId } },
        select: { score: true, note: true, matchedSkills: true, missingSkills: true, shortlisted: true, job: { select: { id: true, title: true } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
  if (!candidate) notFound();

  const hasFile = await prisma.candidate.count({ where: { id: candidate.id, resumeData: { not: null } } });
  const match = candidate.matchScores.find((row) => row.job.id === rawJob) ?? candidate.matchScores[0];
  const source = (candidate.source in SOURCE_LABEL ? candidate.source : "github") as keyof typeof SOURCE_LABEL;
  const Logo = INTEGRATION_LOGOS[source];
  const displayName = candidate.name ?? candidate.login;
  const resumeUrl = `/api/candidates/${candidate.id}/resume`;
  const isPdf = candidate.resumeFileType === "pdf";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <Link href={match ? `/pipeline?job=${match.job.id}` : "/pipeline"} className="flex w-fit items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-950">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to pipeline
      </Link>

      <header className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <p className="section-tag flex items-center gap-1.5">
            <Logo size={14} /> {SOURCE_LABEL[source]}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-950">{displayName}</h1>
          {candidate.headline && <p className="mt-0.5 text-sm text-zinc-600">{candidate.headline}</p>}
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-zinc-600">
            {candidate.location && (
              <div className="flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden="true" />
                {candidate.location}
              </div>
            )}
            {candidate.experienceYears != null && <div className="tabular-nums">{candidate.experienceYears} yrs experience</div>}
            {(candidate.ctc || candidate.noticePeriod) && (
              <div className="flex items-center gap-1.5 tabular-nums">
                <Timer className="size-3.5" aria-hidden="true" />
                {[candidate.ctc, candidate.noticePeriod && `${candidate.noticePeriod} notice`].filter(Boolean).join(" · ")}
              </div>
            )}
            {candidate.phoneNumbers.map((phone) => (
              <a key={phone} href={`tel:${phone}`} className="flex items-center gap-1.5 tabular-nums hover:text-zinc-950">
                <Phone className="size-3.5" aria-hidden="true" /> {phone}
              </a>
            ))}
            {candidate.emails.map((email) => (
              <a key={email} href={`mailto:${email}`} className="flex items-center gap-1.5 hover:text-zinc-950">
                <Mail className="size-3.5" aria-hidden="true" /> {email}
              </a>
            ))}
          </dl>
        </div>
        {match?.score != null && (
          <div className="flex items-center gap-3 sm:flex-col sm:items-center">
            <ScoreRing score={match.score} size={72} />
            <Link href={`/pipeline?job=${match.job.id}`} className="max-w-40 text-xs text-zinc-600 hover:text-zinc-950 sm:text-center">
              {match.job.title}
            </Link>
          </div>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Resume" className="min-w-0 rounded-xl border border-zinc-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-950">
              <FileText className="size-4 text-accent" aria-hidden="true" /> Resume
              {candidate.resumeFileName && <span className="truncate font-normal text-zinc-500">{candidate.resumeFileName}</span>}
            </h2>
            {hasFile > 0 && (
              <a href={resumeUrl} target="_blank" rel="noopener noreferrer" className="ml-auto flex h-8 items-center rounded-lg border border-zinc-200 px-3 text-sm text-zinc-800 hover:bg-zinc-50">
                Open in new tab
              </a>
            )}
            {hasFile > 0 && (
              <a href={`${resumeUrl}?download=1`} className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-800 hover:bg-zinc-50">
                <Download className="size-3.5" aria-hidden="true" /> Download
              </a>
            )}
          </div>

          {hasFile > 0 && isPdf && <iframe title={`Resume of ${displayName}`} src={resumeUrl} className="h-[78vh] w-full rounded-b-xl bg-zinc-50" />}

          {hasFile > 0 && !isPdf && (
            <div className="p-4 text-sm text-zinc-600">
              This resume is a {candidate.resumeFileType?.toUpperCase()} file, which browsers cannot preview. Use Download, or read the extracted text below.
            </div>
          )}

          {candidate.resumeText && (!isPdf || hasFile === 0) && (
            <div className="p-4">
              {hasFile === 0 && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Only the CV text was captured, not the original file. In the extension, open this profile on Naukri and press Save Card again once the CV has loaded to upload the file.
                </p>
              )}
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-800">{candidate.resumeText}</pre>
            </div>
          )}

          {hasFile === 0 && !candidate.resumeText && (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <FileWarning className="size-8 text-zinc-400" aria-hidden="true" />
              <h3 className="text-base font-medium text-zinc-950">No resume stored for {displayName} yet</h3>
              <p className="max-w-md text-sm text-zinc-600">
                {source === "naukri"
                  ? "Naukri CV links only open inside your logged-in Resdex session, so TalentGraph keeps its own copy. Open this profile on Resdex and press Save Card to Shortlist in the extension: it downloads the CV and uploads it here."
                  : "This source does not provide a resume file. Upload one from the Resume Match module."}
              </p>
              {source === "naukri" && (
                <a href={candidate.profileUrl} target="_blank" rel="noopener noreferrer" className="mt-2 flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong">
                  Open on Resdex
                </a>
              )}
            </div>
          )}
          {candidate.resumeCapturedAt && (
            <p className="border-t border-zinc-200 px-4 py-2 text-xs tabular-nums text-zinc-500">Stored {candidate.resumeCapturedAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          {match && (
            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <h2 className="section-tag mb-3">fit for this job</h2>
              {match.note && <p className="mb-3 text-sm text-zinc-800">{match.note}</p>}
              <div className="flex flex-col gap-3">
                <SkillPills title="Matched" skills={match.matchedSkills} variant="matched" />
                <SkillPills title="Missing" skills={match.missingSkills} variant="missing" />
              </div>
            </section>
          )}
          {candidate.skills.length > 0 && (
            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <h2 className="section-tag mb-3">key skills</h2>
              <ul className="flex flex-wrap gap-1.5">
                {candidate.skills.slice(0, 24).map((skill) => (
                  <li key={skill} className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                    {skill}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
