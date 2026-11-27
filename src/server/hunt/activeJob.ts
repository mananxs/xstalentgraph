import { prisma } from "@/server/db";

/**
 * Marks the job an HR is working on. The extension notices it on its next heartbeat (a few seconds) and switches to that job by itself,
 * so a JD uploaded or opened in the web app is what the extension scores and captures for. Never throws: it is a convenience.
 */
export async function setActiveJob(recruiterId: string, jobId: string): Promise<void> {
  await prisma.recruiter.update({ where: { id: recruiterId }, data: { activeJobId: jobId, activeJobAt: new Date() } }).catch(() => undefined);
}
