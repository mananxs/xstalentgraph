import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute } from "@/server/api/http";
import { requireJobAccess } from "@/server/api/guards";
import { requireWriter } from "@/server/auth";
import { ensureRubric, listRubricVersions, rescoreJob, saveRubric } from "@/server/hunt/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/jobs/:id/rubric - the current standard rubric plus its version history. */
export async function GET(_r: Request, context: Ctx): Promise<Response> {
  return handleRoute(async () => {
    const { recruiter, job } = await requireJobAccess((await context.params).id);
    const rubric = await ensureRubric(job, recruiter.id);
    return NextResponse.json({ version: rubric.version, rubric: rubric.data, versions: await listRubricVersions(job.id) });
  });
}

const put = z.object({ rubric: z.unknown(), notes: z.string().max(300).optional(), rescore: z.boolean().default(false) });

/** PUT /api/jobs/:id/rubric - saves a NEW version (old ones are kept). rescore=true re-evaluates the job's candidates under it. */
export async function PUT(request: Request, context: Ctx): Promise<Response> {
  return handleRoute(async () => {
    const writer = await requireWriter();
    const { job } = await requireJobAccess((await context.params).id);
    const input = put.parse(await request.json().catch(() => ({})));
    const saved = await saveRubric(job, input.rubric, writer.id, input.notes);
    const rescored = input.rescore ? (await rescoreJob(job, writer.id)).rescored : null;
    return NextResponse.json({ version: saved.version, rubric: saved.data, rescored });
  });
}
