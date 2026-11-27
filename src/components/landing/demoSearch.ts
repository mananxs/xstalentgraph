import { CITIES, DEMO_CANDIDATES, DEFAULT_WEIGHTS, SKILL_ALIASES, type DemoCandidate, type SourceId } from "./data";

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

const days = (notice: string) => Number(/\d+/.exec(notice)?.[0] ?? 60);

/**
 * Demo ranking with the same logic as the real evaluator: weighted mean over the dimensions that have data. A dimension the prompt gives
 * no requirement for (compensation, education; experience or location when not typed) is skipped, not counted as a failure.
 */
export function rankCandidates(prompt: string, sources: ReadonlySet<SourceId>): { parsed: ParsedPrompt; ranked: RankedCandidate[] } {
  const parsed = parsePrompt(prompt);
  if (parsed.skills.length === 0) return { parsed, ranked: [] };

  const ranked = DEMO_CANDIDATES.filter((candidate) => sources.has(candidate.source))
    .map((candidate) => {
      const matched = parsed.skills.filter((skill) => candidate.skills.includes(skill));
      const missing = parsed.skills.filter((skill) => !candidate.skills.includes(skill));
      const skillFrac = matched.length / parsed.skills.length;
      const parts: Array<[number, number]> = [[DEFAULT_WEIGHTS.skills, skillFrac * 100], [DEFAULT_WEIGHTS.career, 50 + 50 * skillFrac], [DEFAULT_WEIGHTS.availability, days(candidate.notice) <= 60 ? 100 : days(candidate.notice) <= 90 ? 60 : 30]];
      if (parsed.years !== null) parts.push([DEFAULT_WEIGHTS.experience, candidate.years >= parsed.years ? 100 : Math.max(0, 100 - (parsed.years - candidate.years) * 30)]);
      if (parsed.cities.length > 0) parts.push([DEFAULT_WEIGHTS.location, parsed.cities.includes(candidate.city.toLowerCase()) ? 100 : 25]);
      const weight = parts.reduce((sum, [w]) => sum + w, 0);
      const score = Math.round(parts.reduce((sum, [w, v]) => sum + w * v, 0) / weight);
      return { candidate, matched, missing, score };
    })
    .filter((row) => row.matched.length > 0)
    .sort((a, b) => b.score - a.score || b.matched.length - a.matched.length || a.candidate.name.localeCompare(b.candidate.name));

  return { parsed, ranked };
}
