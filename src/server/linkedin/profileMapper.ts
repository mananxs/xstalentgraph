/**
 * Maps one Bright Data "LinkedIn Profile" record into our CandidateProfile-like shape.
 *
 * Bright Data's field names vary a little between dataset versions and records, so every read is defensive:
 * unknown shapes are ignored, never thrown on. Contact data is collected from the structured fields AND
 * scanned out of free text (about / contact blocks), then normalised and de-duplicated.
 */

/** Public LinkedIn data for one person, plus the contact details a recruiter needs to reach out. */
export interface LinkedInProfile {
  /** Stable key: LinkedIn public identifier (the slug in /in/<slug>), lower case. */
  linkedinId: string;
  fullName: string | null;
  headline: string | null;
  summary: string | null;
  location: string | null;
  avatarUrl: string | null;
  skills: string[];
  /** Total professional experience in years, one decimal. null when it cannot be worked out. */
  experienceYears: number | null;
  // ---- contact data (NEVER sent to the AI) ----
  emails: string[];
  phoneNumbers: string[];
  profileUrl: string;
  personalWebsite: string | null;
  /** Other links found (GitHub, Twitter/X, portfolio, ...), excluding linkedin.com and personalWebsite. */
  otherLinks: string[];
}

type Json = Record<string, unknown>;

const MAX_SKILLS = 50;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<![\w.])\+?\d[\d\s().-]{7,}\d(?![\w])/g;
const URL_RE = /https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+/gi;
const SOCIAL_HOSTS = /(github\.com|gitlab\.com|twitter\.com|x\.com|medium\.com|behance\.net|dribbble\.com|stackoverflow\.com|kaggle\.com)/i;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    const text = str(value);
    if (text) return text;
  }
  return null;
}

/** Accepts string | string[] | {name|title|value|email|phone|url}[] and returns plain strings. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return value.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item.trim());
    else if (isObject(item)) {
      const text = first(item.name, item.title, item.value, item.email, item.phone, item.number, item.url, item.link);
      if (text) out.push(text);
    }
  }
  return out.filter(Boolean);
}

function dedupe(values: string[], keyOf: (value: string) => string = (v) => v.toLowerCase()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = keyOf(value);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

export function normaliseEmail(value: string): string | null {
  const email = value.trim().replace(/^mailto:/i, "").replace(/[.,;:]+$/, "").toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email) ? email : null;
}

/** Keeps a leading "+", drops separators. Needs 7-15 digits (E.164 range). */
export function normalisePhone(value: string): string | null {
  const text = value.trim().replace(/^tel:/i, "");
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${text.startsWith("+") ? "+" : ""}${digits}`;
}

export function normaliseUrl(value: string): string | null {
  let text = value.trim().replace(/[.,;:]+$/, "");
  if (!text) return null;
  if (/^www\./i.test(text)) text = `https://${text}`;
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

const isLinkedIn = (url: string): boolean => /(^|\.)linkedin\.com$/i.test(new URL(url).hostname);

/** Extracts the "/in/<slug>" identifier from a LinkedIn URL. */
export function linkedinIdFromUrl(value: string): string | null {
  const match = /linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i.exec(value);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return match[1].toLowerCase();
  }
}

/** Canonical profile URL for a LinkedIn id. */
export const linkedinUrlFromId = (id: string): string => `https://www.linkedin.com/in/${encodeURIComponent(id)}`;

/** Keeps valid LinkedIn profile URLs only, canonicalised and de-duplicated. */
export function normaliseLinkedInUrls(values: string[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of values) {
    const id = linkedinIdFromUrl(value.trim());
    if (id && !seen.has(id)) {
      seen.add(id);
      urls.push(linkedinUrlFromId(id));
    }
  }
  return urls;
}

/** Total experience in years: merges overlapping jobs, so two parallel roles are not counted twice. */
function experienceYearsFrom(record: Json, now: Date): number | null {
  const explicit = record.experience_years ?? record.years_of_experience ?? record.total_experience_years;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) return Math.round(explicit * 10) / 10;

  const jobs = Array.isArray(record.experience) ? record.experience : [];
  const ranges: Array<[number, number]> = [];

  const toTime = (value: unknown): number | null => {
    const text = str(value);
    if (!text) return null;
    if (/present|current|now/i.test(text)) return now.getTime();
    const time = Date.parse(/^\d{4}$/.test(text) ? `${text}-01-01` : text);
    return Number.isNaN(time) ? null : time;
  };

  const collect = (job: Json): void => {
    const start = toTime(job.start_date ?? job.starts_at ?? job.start);
    if (start === null) return;
    const end = toTime(job.end_date ?? job.ends_at ?? job.end) ?? now.getTime();
    if (end >= start) ranges.push([start, Math.min(end, now.getTime())]);
  };

  for (const job of jobs) {
    if (!isObject(job)) continue;
    // Bright Data groups several roles of one company under `positions`.
    if (Array.isArray(job.positions) && job.positions.length > 0) {
      for (const position of job.positions) if (isObject(position)) collect(position);
    } else {
      collect(job);
    }
  }
  if (ranges.length === 0) return null;

  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = ranges[0] as [number, number];
  for (const [start, end] of ranges.slice(1)) {
    if (start <= curEnd) curEnd = Math.max(curEnd, end);
    else {
      total += curEnd - curStart;
      [curStart, curEnd] = [start, end];
    }
  }
  total += curEnd - curStart;
  return Math.round((total / MS_PER_YEAR) * 10) / 10;
}

function skillsFrom(record: Json): string[] {
  const raw = [...strings(record.skills), ...strings(record.top_skills), ...strings(record.skills_list)];
  return dedupe(raw.map((skill) => skill.slice(0, 60))).slice(0, MAX_SKILLS);
}

/** Collects every place Bright Data may put contact details, including free text. */
function contactFrom(record: Json): { emails: string[]; phones: string[]; urls: string[] } {
  const contact = isObject(record.contact_info) ? record.contact_info : isObject(record.contact) ? record.contact : {};
  const freeText = [record.about, record.summary, record.bio, contact.text, record.contact_text]
    .map((value) => str(value))
    .filter((value): value is string => value !== null)
    .join("\n");

  const rawEmails = [
    ...strings(record.email), ...strings(record.emails), ...strings(record.email_address),
    ...strings(contact.email), ...strings(contact.emails),
    ...(freeText.match(EMAIL_RE) ?? []),
  ];
  const rawPhones = [
    ...strings(record.phone), ...strings(record.phones), ...strings(record.phone_number), ...strings(record.phone_numbers),
    ...strings(contact.phone), ...strings(contact.phones), ...strings(contact.phone_numbers),
    ...(freeText.match(PHONE_RE) ?? []),
  ];
  const rawUrls = [
    ...strings(record.website), ...strings(record.websites), ...strings(record.personal_website),
    ...strings(record.contact_websites), ...strings(record.links), ...strings(record.social_links),
    ...strings(contact.website), ...strings(contact.websites), ...strings(contact.links),
    ...(freeText.match(URL_RE) ?? []),
  ];

  return {
    emails: dedupe(rawEmails.map(normaliseEmail).filter((v): v is string => v !== null)),
    phones: dedupe(rawPhones.map(normalisePhone).filter((v): v is string => v !== null)),
    urls: dedupe(rawUrls.map(normaliseUrl).filter((v): v is string => v !== null)),
  };
}

function locationFrom(record: Json): string | null {
  const direct = first(record.location, record.city);
  const country = first(record.country_name, record.country);
  if (direct && country && !direct.toLowerCase().includes(country.toLowerCase())) return `${direct}, ${country}`;
  return direct ?? first(record.country_code);
}

/**
 * Converts one Bright Data record. Returns null when it has no usable identity
 * (Bright Data returns error rows such as { error, input } for URLs it could not scrape).
 */
export function mapBrightDataProfile(raw: unknown, now: Date = new Date()): LinkedInProfile | null {
  if (!isObject(raw)) return null;
  if (typeof raw.error === "string" && !raw.name && !raw.id) return null;

  const sourceUrl = first(raw.url, raw.input_url, raw.profile_url, isObject(raw.input) ? raw.input.url : null);
  const id = (first(raw.linkedin_id, raw.id, raw.public_identifier) ?? (sourceUrl ? linkedinIdFromUrl(sourceUrl) : null))?.toLowerCase();
  if (!id) return null;

  const fullName =
    first(raw.name, raw.full_name) ?? (first(raw.first_name, raw.last_name) ? [raw.first_name, raw.last_name].map(str).filter(Boolean).join(" ") : null);
  const experience = Array.isArray(raw.experience) ? raw.experience.filter(isObject) : [];
  const currentRole = experience[0] ? first(experience[0].title, experience[0].position) : null;
  const headline = first(raw.headline, raw.position, raw.title) ?? currentRole;

  const profileUrl = (sourceUrl && normaliseUrl(sourceUrl)) || linkedinUrlFromId(id);
  const { emails, phones, urls } = contactFrom(raw);

  const external = urls.filter((url) => !isLinkedIn(url));
  const personalWebsite = external.find((url) => !SOCIAL_HOSTS.test(url)) ?? null;
  const otherLinks = external.filter((url) => url !== personalWebsite);

  return {
    linkedinId: id,
    fullName,
    headline,
    summary: first(raw.about, raw.summary),
    location: locationFrom(raw),
    avatarUrl: first(raw.avatar, raw.avatar_url, raw.profile_pic_url, raw.image),
    skills: skillsFrom(raw),
    experienceYears: experienceYearsFrom(raw, now),
    emails,
    phoneNumbers: phones,
    profileUrl,
    personalWebsite,
    otherLinks,
  };
}
