import { NextResponse } from "next/server";
import { ApiError } from "@/server/api/http";
import { uuidSchema } from "@/server/api/guards";
import { prisma } from "@/server/db";
import { extensionRoute } from "@/server/extension/route";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** POST /api/extension/agent/commands/:id/ack - "I have this command". Acknowledging twice is harmless. */
export async function POST(request: Request, context: Ctx): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const id = uuidSchema.parse((await context.params).id);
    const command = await prisma.sourcingCommand.findFirst({ where: { id, task: { organizationId: recruiter.organizationId, createdById: recruiter.id } }, select: { id: true, status: true } });
    if (!command) throw new ApiError(404, "Command not found.");
    if (command.status === "pending") await prisma.sourcingCommand.update({ where: { id }, data: { status: "acked", ackedAt: new Date() } });
    return NextResponse.json({ ok: true, status: command.status === "pending" ? "acked" : command.status });
  });
}
