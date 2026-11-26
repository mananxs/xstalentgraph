import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/server/api/http";
import { prisma } from "@/server/db";
import { getEnv } from "@/server/env";
import { ensureOpenRecruiter, findRecruiterByEmail, type RecruiterContext } from "@/server/repositories/recruiterRepository";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** A new personal key, e.g. "tgx_3kF…". Only its hash is stored; the plain key is shown to the recruiter once. */
export async function createApiKey(recruiterId: string, label = "Naukri extension"): Promise<string> {
  const key = `tgx_${randomBytes(24).toString("base64url")}`;
  await prisma.apiKey.create({ data: { recruiterId, keyHash: sha256(key), label } });
  return key;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Authenticates an /api/extension/* call. Accepts the recruiter's personal key (created by login or in Settings), or the
 * shared EXTENSION_API_KEY from .env (acts as EXTENSION_RECRUITER_EMAIL). Returns the recruiter the request acts as.
 */
export async function requireExtensionUser(request: Request): Promise<RecruiterContext> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new ApiError(401, "Not signed in to the extension.");
  const env = getEnv();

  const row = await prisma.apiKey.findUnique({ where: { keyHash: sha256(token) }, select: { id: true, recruiter: { select: { id: true, email: true, name: true, organizationId: true } } } });
  if (row) {
    void prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return row.recruiter;
  }

  if (env.EXTENSION_API_KEY && sameSecret(token, env.EXTENSION_API_KEY)) {
    const email = env.EXTENSION_RECRUITER_EMAIL ?? env.DEV_RECRUITER_EMAIL;
    const recruiter = env.OPEN_ACCESS ? await ensureOpenRecruiter(email) : await findRecruiterByEmail(email);
    if (!recruiter) throw new ApiError(500, `No recruiter with email ${email}. Create one with: npm run user:create`);
    return recruiter;
  }
  throw new ApiError(401, "Your session expired. Log in again.");
}
