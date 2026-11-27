import { jobWhere as jobScope } from "@/server/access";
import { SHORTLIST_STAGES } from "@/server/hunt/stages";
import { scoredByOf } from "@/server/ai/heuristic";
import { handleRoute, jsonOk } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { prisma } from "@/server/db";
import { listShortlistedResumes } from "@/server/repositories/resumeRepository";

export const dynamic = "force-dynamic";

/** GET /api/shortlists - everyone shortlisted across all jobs: GitHub candidates and uploaded resumes. */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const recruiter = await requireRecruiter();
    const [github, resumes] = await Promise.all([
      prisma.matchScore.findMany({
        where: { stage: { in: [...SHORTLIST_STAGES] }, job: jobScope(recruiter) },
        select: {
          id: true,
          score: true,
          model: true,
          matchedSkills: true,
          note: true,
          stage: true,
          tier: true,
          job: { select: { id: true, title: true } },
          candidate: {
            select: {
              id: true,
              source: true,
              login: true,
              name: true,
              avatarUrl: true,
              profileUrl: true,
              location: true,
              headline: true,
              experienceYears: true,
              ctc: true,
              noticePeriod: true,
              resumeText: true,
              resumeFileName: true,
            },
          },
        },
        orderBy: { score: "desc" },
        take: 500,
      }),
      listShortlistedResumes(recruiter),
    ]);

    return jsonOk({
      github: github.map(({ candidate: { id: candidateId, resumeText, resumeFileName, source, ...candidate }, ...row }) => ({
        id: row.id,
        score: row.score,
        scoredBy: scoredByOf(row.model),
        matchedSkills: row.matchedSkills,
        note: row.note,
        stage: row.stage,
        tier: row.tier,
        matchId: row.id,
        jobId: row.job.id,
        jobTitle: row.job.title,
        candidateId,
        source: source as "github" | "linkedin" | "cutshort" | "naukri",
        hasResume: Boolean(resumeText || resumeFileName),
        ...candidate,
      })),
      resumes,
    });
  });
}
