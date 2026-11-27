import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformLlmClient } from "@/server/ai/llm";
import { clearKeyCache, listKeys, PROVIDERS, removeKey, saveKey, testKey, type Provider } from "@/server/ai/userKeys";
import { decryptSecret } from "@/server/crypto/tokens";
import { ApiError, handleRoute } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const provider = z.enum(PROVIDERS);

/** GET /api/ai-keys - the signed-in HR's own AI keys (never the key itself) and whether a platform fallback key exists. */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const me = await requireRecruiter();
    return NextResponse.json({
      keys: await listKeys(me.id),
      platformFallback: getPlatformLlmClient().configured,
      order: /^\s*gemini\s*,/i.test(process.env.LLM_PROVIDER_ORDER ?? "") ? ["gemini", "groq"] : ["groq", "gemini"],
    });
  });
}

/** PUT /api/ai-keys { provider, key } - checks the key with the provider, then stores it encrypted. */
export async function PUT(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const me = await requireRecruiter();
    const input = z.object({ provider, key: z.string().min(1).max(300) }).parse(await request.json().catch(() => ({})));
    try {
      return NextResponse.json({ key: await saveKey(me.id, input.provider, input.key) });
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : "Could not save the key.");
    }
  });
}

/** POST /api/ai-keys { provider } - re-checks a saved key (e.g. after a quota reset) and makes it active again if it works. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const me = await requireRecruiter();
    const input = z.object({ provider }).parse(await request.json().catch(() => ({})));
    const row = await prisma.aiCredential.findUnique({ where: { recruiterId_provider: { recruiterId: me.id, provider: input.provider } } });
    if (!row) throw new ApiError(404, "No key saved for that provider.");
    const verdict = await testKey(input.provider as Provider, decryptSecret(row.encryptedKey));
    await prisma.aiCredential.update({ where: { id: row.id }, data: verdict.ok ? { status: "active", coolingUntil: null, lastError: null } : verdict.reason === "invalid" ? { status: "invalid", lastError: verdict.message ?? "Rejected by the provider." } : { lastError: verdict.message ?? null } });
    clearKeyCache(me.id);
    return NextResponse.json({ ok: verdict.ok, message: verdict.message ?? null, keys: await listKeys(me.id) });
  });
}

/** DELETE /api/ai-keys?provider=groq - removes the key. */
export async function DELETE(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const me = await requireRecruiter();
    const p = provider.parse(new URL(request.url).searchParams.get("provider"));
    await removeKey(me.id, p);
    return NextResponse.json({ ok: true });
  });
}
