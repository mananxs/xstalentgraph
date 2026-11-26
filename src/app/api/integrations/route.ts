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

    const naukriCount = await prisma.candidate.count({ where: { source: "naukri" } }).catch(() => 0);
    const extensionKeys = await prisma.apiKey.count().catch(() => 0);
    const naukri: IntegrationDto = !env.EXTENSION_API_KEY && extensionKeys === 0 && naukriCount === 0
      ? { id: "naukri", name: "Naukri", status: "not_connected", detail: "Open the XS-NaukriAI extension, enter this site's URL and log in with your TalentGraph email and password." }
      : {
          id: "naukri",
          name: "Naukri",
          status: "connected",
          detail: naukriCount > 0 ? `Resdex via the XS-NaukriAI extension. ${naukriCount} candidate${naukriCount === 1 ? "" : "s"} received, resumes stored here.` : "Resdex via the XS-NaukriAI extension. Waiting for the first shortlisted card.",
        };

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
