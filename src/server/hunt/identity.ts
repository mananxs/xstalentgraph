/**
 * Unified candidate identity. One person = one Candidate; every source (Naukri, LinkedIn, GitHub, Cutshort, Direct) adds a
 * CandidateSource record to it. Two records are the same person only when a RELIABLE identifier agrees:
 *   1. the same source + external id,   2. the same e-mail,   3. the same phone,   4. the same profile URL,
 *   5. the same name AND company AND experience (within one year) - and only when company and experience are both known.
 * A name on its own never merges anyone.
 */
export interface IdentityProbe {
  name?: string | null;
  emails?: string[];
  phones?: string[];
  profileUrl?: string | null;
  company?: string | null;
  expYears?: number | null;
}

export interface KnownCandidate extends IdentityProbe {
  id: string;
}

export type MatchReason = "email" | "phone" | "profile_url" | "name_company_experience";

const clean = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export const normEmail = (value: string) => value.trim().toLowerCase();

/** Last 10 digits of an Indian-style number; null when it is not a plausible phone. */
export function normPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const last10 = digits.length >= 10 ? digits.slice(-10) : "";
  return /^[6-9]\d{9}$/.test(last10) ? last10 : null;
}

export function normUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    // A bare site root or a generic list page identifies nobody.
    if (url.pathname === "/" || url.pathname === "") return null;
    const keep = [...url.searchParams.entries()].filter(([key]) => /^(id|uid|candidateid|cid|profileid)$/i.test(key));
    return `${host}${url.pathname.replace(/\/+$/, "").toLowerCase()}${keep.length ? "?" + keep.map(([k, v]) => `${k.toLowerCase()}=${v}`).join("&") : ""}`;
  } catch {
    return null;
  }
}

/** Finds the already-known candidate this probe describes, or null. Pure: easy to test, no database. */
export function findIdentity(known: KnownCandidate[], probe: IdentityProbe): { id: string; reason: MatchReason } | null {
  const emails = new Set((probe.emails ?? []).map(normEmail).filter(Boolean));
  const phones = new Set((probe.phones ?? []).map(normPhone).filter((p): p is string => p !== null));
  const url = normUrl(probe.profileUrl);

  for (const candidate of known) {
    if (emails.size && (candidate.emails ?? []).some((email) => emails.has(normEmail(email)))) return { id: candidate.id, reason: "email" };
  }
  for (const candidate of known) {
    if (phones.size && (candidate.phones ?? []).some((phone) => { const n = normPhone(phone); return n !== null && phones.has(n); })) return { id: candidate.id, reason: "phone" };
  }
  for (const candidate of known) {
    if (url && normUrl(candidate.profileUrl) === url) return { id: candidate.id, reason: "profile_url" };
  }
  const name = clean(probe.name);
  const company = clean(probe.company);
  const exp = typeof probe.expYears === "number" && probe.expYears >= 0 ? probe.expYears : null;
  if (name.split(" ").length >= 2 && company && exp !== null) {
    for (const candidate of known) {
      const otherExp = typeof candidate.expYears === "number" && candidate.expYears >= 0 ? candidate.expYears : null;
      if (otherExp !== null && clean(candidate.name) === name && clean(candidate.company) === company && Math.abs(otherExp - exp) <= 1) {
        return { id: candidate.id, reason: "name_company_experience" };
      }
    }
  }
  return null;
}
