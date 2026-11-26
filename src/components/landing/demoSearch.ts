import { CITIES, DEMO_CANDIDATES, SKILL_ALIASES, STANDARD_WEIGHTS, type DemoCandidate, type SourceId } from "./data";

export interface ParsedPrompt {
  skills: string[];
  cities: string[];
  years: number | null;
}

export interface RankedCandidate {
  candidate: DemoCandidate;
  score: number;
  matched: string[];
  missing: string[];
}

const canonicalCity = (city: string) => (city === "bangalore" ? "bengaluru" : city === "gurgaon" ? "gurugram" : city);

/** Reads skills, cities and "5+ years" out of a free-text requirement. Pure, so it is easy to test. */
export function parsePrompt(prompt: string): ParsedPrompt {
  const text = prompt.toLowerCase();
  const tokens = text.split(/[^a-z0-9.+#]+/).filter(Boolean);
  const skills = [...new Set(tokens.map((token) => SKILL_ALIASES[token]).filter((skill): skill is string => Boolean(skill)))];
  const cities = [...new Set(CITIES.filter((city) => new RegExp(`\\b${city}\\b`).test(text)).map(canonicalCity))];
  const years = /(\d{1,2})\s*\+?\s*(?:yrs?|years?)/.exec(text);
  return { skills, cities, years: years ? Number(years[1]) : null };
}

/** The standard weighting: skills 60, experience 25, location 15. Same for every job and every recruiter. */
export function rankCandidates(prompt: string, sources: ReadonlySet<SourceId>): { parsed: ParsedPrompt; ranked: RankedCandidate[] } {
  const parsed = parsePrompt(prompt);
  if (parsed.skills.length === 0) return { parsed, ranked: [] };

  const ranked = DEMO_CANDIDATES.filter((candidate) => sources.has(candidate.source))
    .map((candidate) => {
      const matched = parsed.skills.filter((skill) => candidate.skills.includes(skill));
      const missing = parsed.skills.filter((skill) => !candidate.skills.includes(skill));
      const skillPart = (matched.length / parsed.skills.length) * STANDARD_WEIGHTS.skills;
      const experiencePart =
        parsed.years === null || candidate.years >= parsed.years ? STANDARD_WEIGHTS.experience : Math.max(0, STANDARD_WEIGHTS.experience - (parsed.years - candidate.years) * 8);
      // Demo stand-ins for the two softer dimensions (the real model reads achievements and domain from the profile text).
      const impactPart = Math.min(1, 0.5 + candidate.years / 20) * STANDARD_WEIGHTS.impact;
      const industryPart = 0.7 * STANDARD_WEIGHTS.industry;
      const cityPenalty = parsed.cities.length > 0 && !parsed.cities.includes(candidate.city.toLowerCase()) ? 10 : 0;
      return { candidate, matched, missing, score: Math.max(0, Math.round(skillPart + experiencePart + impactPart + industryPart - cityPenalty)) };
    })
    .filter((row) => row.matched.length > 0)
    .sort((a, b) => b.score - a.score || b.matched.length - a.matched.length || a.candidate.name.localeCompare(b.candidate.name));

  return { parsed, ranked };
}
