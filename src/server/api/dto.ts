import { scoredByOf } from "@/server/ai/heuristic";
import type { BatchView } from "@/server/repositories/batchRepository";
import type { MatchRow } from "@/server/repositories/matchRepository";
import type { JobDetails } from "@/server/repositories/jobRepository";
import type { BatchDto, JobDetailDto, MatchDto } from "@/lib/types";

/** Converts a database match row into the JSON the browser receives (BigInt becomes a string). */
export function toMatchDto(row: MatchRow): MatchDto {
  return {
    matchId: row.matchId,
    status: row.status,
    score: row.score,
    error: row.error,
    matchedSkills: row.matchedSkills,
    missingSkills: row.missingSkills,
    shortlisted: row.shortlisted,
    scoredBy: row.status !== "completed" ? null : scoredByOf(row.model),
    model: row.model,
    candidate: {
      id: row.candidateId,
      githubId: row.githubId?.toString() ?? null,
      source: row.source,
      login: row.login,
      name: row.name,
      avatarUrl: row.avatarUrl,
      profileUrl: row.profileUrl,
      bio: row.bio,
      location: row.location,
      headline: row.headline,
      skills: row.skills,
      experienceYears: row.experienceYears,
      ctc: row.ctc,
      noticePeriod: row.noticePeriod,
      note: row.note,
      hasResume: row.hasResume,
      contact: {
        emails: row.emails,
        phoneNumbers: row.phoneNumbers,
        profileUrl: row.profileUrl,
        personalWebsite: row.personalWebsite,
        otherLinks: row.otherLinks,
      },
    },
  };
}

/** Converts a batch into the JSON the browser receives (dates become ISO strings). */
export function toBatchDto(batch: BatchView): BatchDto {
  return {
    id: batch.id,
    status: batch.status,
    control: batch.control === "pause" || batch.control === "stop" ? batch.control : "run",
    maxProfiles: batch.maxProfiles,
    profilesFound: batch.profilesFound,
    candidatesUpserted: batch.candidatesUpserted,
    embeddedCount: batch.embeddedCount,
    evaluationTotal: batch.evaluationTotal,
    evaluatedCount: batch.evaluatedCount,
    failedCount: batch.failedCount,
    error: batch.error,
    startedAt: batch.startedAt?.toISOString() ?? null,
    finishedAt: batch.finishedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
  };
}

export function toJobDetailDto(job: JobDetails): JobDetailDto {
  return {
    id: job.id,
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
    source: job.source,
    sourceFileName: job.sourceFileName,
    createdAt: job.createdAt.toISOString(),
  };
}
