import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/api/http";
import { ensureRubric } from "@/server/hunt/store";
import { extensionRoute } from "@/server/extension/route";
import { jobSummary } from "@/server/extension/rubric";
import { extractJd } from "@/server/jd/extract";
import { createJob, listJobsWithMatchCounts, findJobInOrganization } from "@/server/repositories/jobRepository";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/extension/jobs - the organization's jobs with their rubric and the Resdex search plan. */
export async function GET(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const rows = await listJobsWithMatchCounts(recruiter.organizationId);
    const jobs = [];
    for (const row of rows.slice(0, 100)) {
      const job = await findJobInOrganization(row.id, recruiter.organizationId);
      if (job) jobs.push(jobSummary(job, row.matchCount, (await ensureRubric(job, recruiter.id)).version));
    }
    return NextResponse.json({ jobs });
  });
}

const createSchema = z.object({ rawDescription: z.string().trim().min(20).max(60_000), title: z.string().trim().max(200).optional() });

/** POST /api/extension/jobs { rawDescription, title? } - an ad-hoc job from a pasted JD (read by the AI, or the offline parser). */
export async function POST(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const { rawDescription, title } = createSchema.parse(await request.json().catch(() => ({})));
    const jd = await extractJd(rawDescription);
    const name = title || jd.title || "Untitled job";
    if (!name.trim()) throw new ApiError(400, "Could not find a job title in that description.");
    const job = await createJob({
      organizationId: recruiter.organizationId,
      createdById: recruiter.id,
      title: name,
      description: jd.description || rawDescription.slice(0, 4000),
      requiredSkills: jd.requiredSkills,
      preferredSkills: jd.preferredSkills,
      technologies: jd.technologies,
      handsOn: jd.handsOn,
      languages: jd.languages,
      locations: jd.locations,
      remoteAllowed: jd.remoteAllowed,
      experienceYears: jd.experienceYears,
      seniority: jd.seniority,
      workMode: jd.workMode,
      employmentType: jd.employmentType,
      source: "pasted",
      sourceFileName: null,
      rawText: rawDescription.slice(0, 60_000),
    });
    return NextResponse.json({ job: jobSummary(job, 0) }, { status: 201 });
  });
}
