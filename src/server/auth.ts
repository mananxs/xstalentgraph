import { ApiError } from "@/server/api/http";
import { getEnv } from "@/server/env";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/server/session";
import { ensureOpenRecruiter, findRecruiterByEmail, findRecruiterById, type RecruiterContext } from "@/server/repositories/recruiterRepository";

/**
 * Returns the signed-in recruiter, or throws a 401/500 ApiError.
 * Every API route calls this first, then checks the job belongs to the recruiter's organization.
 */
export async function requireRecruiter(): Promise<RecruiterContext> {
  const env = getEnv();

  if (env.OPEN_ACCESS) {
    // Testing mode: no login. The recruiter is created on first use, so no seed step is needed.
    return ensureOpenRecruiter(env.EXTENSION_RECRUITER_EMAIL ?? env.DEV_RECRUITER_EMAIL);
  }

  if (env.DEV_AUTH) {
    // Safety net: DEV_AUTH skips login, so it must never run in a production build.
    if (process.env.NODE_ENV === "production") {
      throw new ApiError(500, "DEV_AUTH=true is not allowed in production. Set it to false and add real login.");
    }
    const recruiter = await findRecruiterByEmail(env.DEV_RECRUITER_EMAIL);
    if (!recruiter) {
      throw new ApiError(500, "DEV_AUTH is on but the seeded recruiter was not found. Run: npx prisma db seed");
    }
    return recruiter;
  }

  // Email + password login: a signed cookie set by /api/auth/login names the recruiter.
  const recruiterId = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const recruiter = recruiterId ? await findRecruiterById(recruiterId) : null;
  if (!recruiter) throw new ApiError(401, "You are not signed in.");
  return recruiter;
}

/** Same as requireRecruiter, but refuses read-only members ("viewer"). Use for every route that changes data. */
export async function requireWriter(): Promise<RecruiterContext> {
  const recruiter = await requireRecruiter();
  if (recruiter.role === "viewer") throw new ApiError(403, "Your role is read-only. Ask an admin to change it.");
  return recruiter;
}

/** Admin-only routes (team management). */
export async function requireAdmin(): Promise<RecruiterContext> {
  const recruiter = await requireRecruiter();
  if (recruiter.role !== "admin") throw new ApiError(403, "Only an admin can do this.");
  return recruiter;
}
