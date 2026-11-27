import { parseCard } from "@/server/extension/cardParse";
import type { CandidateFacts } from "./evaluate";

type Parsed = ReturnType<typeof parseCard>;
const known = (n: number | undefined | null) => (typeof n === "number" && n >= 0 ? n : null);

/** Facts for the evaluator from a parsed Resdex card (+ the raw text it came from). */
export function factsFromParsed(parsed: Parsed, rawText: string): CandidateFacts {
  return {
    name: parsed.fullName,
    headline: parsed.headline,
    role: parsed.currentRole,
    company: parsed.currentCompany,
    skills: parsed.skills,
    expYears: known(parsed.expYears),
    currentCtcLpa: known(parsed.currentCtcLpa),
    expectedCtcLpa: known(parsed.expectedCtcLpa),
    noticeDays: known(parsed.noticeDays),
    location: parsed.location,
    prefLocations: parsed.prefLocations,
    education: parsed.education,
    text: rawText,
  };
}

/** Facts from a stored Candidate row (used when re-scoring candidates of any source). */
export function factsFromCandidateRow(c: {
  name: string | null;
  headline: string | null;
  skills: string[];
  experienceYears: number | null;
  ctc: string | null;
  noticePeriod: string | null;
  location: string | null;
  bio: string | null;
  profileText: string | null;
  resumeText: string | null;
}): CandidateFacts {
  const ctc = c.ctc ? /([\d.]+)/.exec(c.ctc) : null;
  const notice = c.noticePeriod ? parseCard(`Notice period: ${c.noticePeriod}`).noticeDays : -1;
  return {
    name: c.name ?? undefined,
    headline: c.headline ?? undefined,
    skills: c.skills,
    expYears: c.experienceYears,
    currentCtcLpa: ctc ? Number(ctc[1]) : null,
    expectedCtcLpa: null,
    noticeDays: notice >= 0 ? notice : null,
    location: c.location ?? undefined,
    text: [c.profileText, c.bio, c.resumeText].filter(Boolean).join("\n").slice(0, 20_000),
  };
}
