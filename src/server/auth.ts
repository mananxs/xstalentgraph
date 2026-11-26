import { ApiError } from "@/server/api/http";
import { getEnv } from "@/server/env";
import { findRecruiterByEmail, type RecruiterContext } from "@/server/repositories/recruiterRepository";

/**
 * Returns the signed-in recruiter, or throws a 401/500 ApiError.
 * Every API route calls this first, then checks the job belongs to the recruiter's organization.
 */
export async function requireRecruiter(): Promise<RecruiterContext> {
  const env = getEnv();

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

  // ============================================================================
  // INTEGRATION POINT: Auth.js (GitHub login)
  // Later: read the session here (for example `const session = await auth()`),
  // look the recruiter up by session.user.email with findRecruiterByEmail(),
  // and return it. Nothing else in the app needs to change.
  // ============================================================================
  throw new ApiError(401, "You are not signed in.");
}
