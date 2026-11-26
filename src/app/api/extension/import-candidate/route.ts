import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@/server/api/guards";
import { extractContacts } from "@/server/extension/contacts";
import { extensionRoute } from "@/server/extension/route";
import { saveNaukriShortlist } from "@/server/naukri/intake";
import { personKey, type ShortlistPayload } from "@/server/naukri/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const num = z.number().nullish();
const card = z.object({
  fullName: z.string().trim().max(200),
  currentRole: z.string().max(200).default(""),
  currentCompany: z.string().max(200).default(""),
  totalExp: num,
  currentCtc: num,
  expectedCtc: num,
  noticePeriod: z.string().max(80).default(""),
  location: z.string().max(200).default(""),
  naukriProfileUrl: z.string().max(1000).optional(),
  rawProfileText: z.string().max(6000).optional(),
  aiScore: z.number().min(0).max(100),
  matchedSkills: z.array(z.string().max(120)).max(60).default([]),
  missingSkills: z.array(z.string().max(120)).max(60).default([]),
  verdict: z.string().max(2000).default(""),
});
const audit = z.object({
  extracted: z.object({
    fullName: z.string().default(""),
    currentRole: z.string().default(""),
    currentCompany: z.string().default(""),
    totalExpYears: z.number().default(-1),
    currentCtcLpa: z.number().default(-1),
    noticePeriod: z.string().default(""),
    location: z.string().default(""),
    email: z.string().default(""),
    phone: z.string().default(""),
  }),
  score: z.number().min(0).max(100),
  matchedSkills: z.array(z.string()).default([]),
  missingSkills: z.array(z.string()).default([]),
  verdict: z.string().default(""),
});
const body = z.union([
  z.object({ jobId: uuidSchema, card }),
  z.object({ jobId: uuidSchema, profileUrl: z.string().max(1000).optional(), rawText: z.string().min(50).max(60_000), audit }),
]);

const lpa = (value: number | null | undefined) => (typeof value === "number" && value > 0 ? `${value} LPA` : null);
const exp = (value: number | null | undefined) => (typeof value === "number" && value >= 0 ? value : null);

/**
 * POST /api/extension/import-candidate - "Save Card to Shortlist" ({card}) and "Save & Shortlist" on an opened profile ({rawText, audit}).
 * Both land in the SAME pipeline as every other source, keyed by the person (name + company + experience), so a card saved earlier and
 * its full profile are one candidate. A later card save never overwrites a saved full profile.
 */
export async function POST(request: Request): Promise<Response> {
  return extensionRoute(request, async (recruiter) => {
    const input = body.parse(await request.json().catch(() => ({})));
    let payload: ShortlistPayload;
    let mode: "card" | "profile";
    let contact = { phone: null as string | null, email: null as string | null, phoneMasked: false };

    if ("card" in input) {
      const c = input.card;
      mode = "card";
      payload = {
        job: { id: input.jobId, requiredSkills: [], preferredSkills: [], locations: [] },
        candidate: {
          naukriId: personKey({ fullName: c.fullName, currentCompany: c.currentCompany, expYears: c.totalExp }),
          name: c.fullName || "Unknown candidate",
          headline: [c.currentRole, c.currentCompany].filter(Boolean).join(" at ") || null,
          location: c.location || null,
          experienceYears: exp(c.totalExp),
          ctc: lpa(c.currentCtc),
          noticePeriod: c.noticePeriod || null,
          skills: [],
          emails: [],
          phones: [],
          profileUrl: c.naukriProfileUrl ?? null,
          summary: c.rawProfileText ?? null,
        },
        analysis: { score: c.aiScore, matchedSkills: c.matchedSkills, missingSkills: c.missingSkills, reason: c.verdict || null },
      };
    } else {
      const x = input.audit.extracted;
      const contacts = extractContacts(input.rawText);
      const phones = [...new Set([...(x.phone ? [x.phone] : []), ...contacts.phones])];
      const emails = [...new Set([...(x.email ? [x.email.toLowerCase()] : []), ...contacts.emails])];
      mode = "profile";
      contact = { phone: phones[0] ?? null, email: emails[0] ?? null, phoneMasked: contacts.phoneMasked && phones.length === 0 };
      payload = {
        job: { id: input.jobId, requiredSkills: [], preferredSkills: [], locations: [] },
        candidate: {
          naukriId: personKey({ fullName: x.fullName, currentCompany: x.currentCompany, expYears: x.totalExpYears }),
          name: x.fullName || "Unknown candidate",
          headline: [x.currentRole, x.currentCompany].filter(Boolean).join(" at ") || null,
          location: x.location || null,
          experienceYears: exp(x.totalExpYears),
          ctc: lpa(x.currentCtcLpa),
          noticePeriod: x.noticePeriod && x.noticePeriod !== "Not mentioned" ? x.noticePeriod : null,
          skills: input.audit.matchedSkills,
          emails: emails.slice(0, 5),
          phones: phones.slice(0, 5),
          profileUrl: input.profileUrl?.startsWith("http") ? input.profileUrl : null,
          summary: null,
        },
        analysis: { score: input.audit.score, matchedSkills: input.audit.matchedSkills, missingSkills: input.audit.missingSkills, reason: input.audit.verdict || null },
        resumeText: input.rawText,
      };
    }

    const result = await saveNaukriShortlist({ recruiter, payload, resume: null, mode });
    return NextResponse.json(
      {
        duplicate: !result.created,
        keptFullProfile: result.keptFullProfile,
        webUrl: result.profilePath,
        candidate: { id: result.candidateId },
        contact,
      },
      { status: result.created ? 201 : 200 },
    );
  });
}
