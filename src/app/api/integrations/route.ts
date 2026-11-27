import { jobWhere as jobScope } from "@/server/access";
import { handleRoute, jsonOk } from "@/server/api/http";
import { requireRecruiter } from "@/server/auth";
import { prisma } from "@/server/db";
import { getEnv } from "@/server/env";
import { getDecryptedToken } from "@/server/repositories/tokenRepository";
import type { IntegrationDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/integrations - which candidate sources are connected. GitHub is live; the others are on the roadmap. */
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const recruiter = await requireRecruiter();
    let github: IntegrationDto = {
      id: "github",
      name: "GitHub",
      status: "not_connected",
      detail: "No GitHub token stored. Run: npx prisma db seed",
    };
    try {
      const token = await getDecryptedToken(recruiter.id, "github");
      if (token) github = { ...github, status: "connected", detail: "Public profiles, languages and repository topics" };
    } catch {
      github = { ...github, detail: "Stored token cannot be read (TOKEN_ENCRYPTION_KEY changed?). Re-run the seed." };
    }

    const env = getEnv();
    const cutshort: IntegrationDto = env.CUTSHORT_API_KEY
      ? { id: "cutshort", name: "Cutshort", status: "connected", detail: "Indian tech talent search; contact details unlocked only for the best matches" }
      : { id: "cutshort", name: "Cutshort", status: "not_connected", detail: "Set CUTSHORT_API_KEY in .env and restart the app." };
    const linkedin: IntegrationDto = !env.APIFY_API_TOKEN
      ? { id: "linkedin", name: "LinkedIn", status: "not_connected", detail: "Set APIFY_API_TOKEN in .env and restart the app." }
      : { id: "linkedin", name: "LinkedIn", status: "connected", detail: "Profiles found with Google X-Ray search (Apify); phone numbers read free from search snippets" };

    const naukriCount = await prisma.candidate.count({ where: { source: "naukri", matchScores: { some: { job: jobScope(recruiter) } } } }).catch(() => 0);
    const beat = await prisma.extensionConnection.findFirst({ where: { recruiterId: recruiter.id }, orderBy: { lastSeenAt: "desc" } }).catch(() => null);
    const live = beat ? Date.now() - beat.lastSeenAt.getTime() < 45_000 : false;
    const naukri: IntegrationDto = !beat
      ? { id: "naukri", name: "Naukri", status: "not_connected", detail: "No extension has connected yet. Install the XS-Hunt extension, enter this site's address and log in." }
      : live
        ? { id: "naukri", name: "Naukri", status: "connected", detail: `Extension connected. Naukri session: ${beat.naukriState.replace("_", " ")}. ${naukriCount} Naukri candidate${naukriCount === 1 ? "" : "s"} so far.` }
        : { id: "naukri", name: "Naukri", status: "not_connected", detail: `Extension offline (last heartbeat ${Math.round((Date.now() - beat.lastSeenAt.getTime()) / 60000)} min ago).` };

    const integrations: IntegrationDto[] = [
      github,
      linkedin,
      cutshort,
      naukri,
      { id: "indeed", name: "Indeed", status: "coming_soon", detail: "Resume search and job applicants" },
    ];
    return jsonOk({ integrations });
  });
}
