import { createHash, randomInt } from "node:crypto";
import { prisma } from "@/server/db";
import { createApiKey } from "./auth";

/** Unambiguous characters only (no 0/O, 1/I/L), so a code read off a screen is typed correctly. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIRING_TTL_MS = 10 * 60_000;

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
export const normaliseCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^XSH/, "");

export function formatCode(core: string): string {
  return `XSH-${core.slice(0, 4)}-${core.slice(4, 8)}`;
}

/** A fresh one-time code for this recruiter. Older unused codes are revoked, so only the newest works. */
export async function createPairingCode(recruiterId: string, now = Date.now()): Promise<{ code: string; expiresAt: Date }> {
  await prisma.pairingCode.deleteMany({ where: { recruiterId, usedAt: null } });
  const core = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const expiresAt = new Date(now + PAIRING_TTL_MS);
  await prisma.pairingCode.create({ data: { recruiterId, codeHash: sha(core), expiresAt } });
  return { code: formatCode(core), expiresAt };
}

export interface Paired {
  apiKey: string;
  user: { id: string; email: string; name: string };
}

/** Exchanges a valid, unused, unexpired code for this recruiter's own extension key. The code works exactly once. */
export async function redeemPairingCode(raw: string, now = Date.now()): Promise<Paired | null> {
  const core = normaliseCode(raw);
  if (core.length !== 8) return null;
  // Claim atomically: two devices racing with the same code cannot both succeed.
  const claimed = await prisma.pairingCode.updateMany({ where: { codeHash: sha(core), usedAt: null, expiresAt: { gt: new Date(now) } }, data: { usedAt: new Date(now) } });
  if (claimed.count !== 1) return null;
  const row = await prisma.pairingCode.findUnique({ where: { codeHash: sha(core) }, select: { recruiter: { select: { id: true, email: true, name: true } } } });
  if (!row) return null;
  const apiKey = await createApiKey(row.recruiter.id, "Extension (paired)");
  return { apiKey, user: row.recruiter };
}

/** What the HR pastes into the extension: the site address and the code in one string, so there is one thing to copy. */
export function connectionString(origin: string, code: string): string {
  return `xsh1.${Buffer.from(JSON.stringify({ u: origin, c: code })).toString("base64url")}`;
}
