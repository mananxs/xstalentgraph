import { stripIndianMobiles } from "@/server/sourcing/phone";

/** Profile fields that are allowed to reach the AI. Name, photo, login and account age are NOT here on purpose. */
export interface ProfileTextInput {
  bio: string | null;
  location: string | null;
  topLanguages: Record<string, number>;
  topics: string[];
}

/**
 * LinkedIn fields that are allowed to reach the AI. Name, photo, emails, phone numbers and links are NOT here
 * on purpose: contact data is for the recruiter only and must never be sent to a model.
 */
export interface LinkedInProfileTextInput {
  headline: string | null;
  summary: string | null;
  location: string | null;
  skills: string[];
  experienceYears: number | null;
}

/** Job fields the AI sees. */
export interface JobTextInput {
  title: string;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  languages: string[];
  locations: string[];
  remoteAllowed: boolean;
}

const MAX_BIO_CHARS = 500;

/** Collapses whitespace so a bio cannot fake new "sections" with blank lines. */
function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Makes user-supplied text safe to put between our prompt tags:
 * angle brackets are escaped, so text can never close a tag like </candidate_profile>.
 */
export function escapeForPrompt(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Builds the plain-text profile that is embedded and scored.
 * It contains only evidence the recruiter is allowed to judge on:
 * bio, location, languages and repository topics.
 * Name, login, avatar, gender hints, account age and follower counts are left out on purpose.
 */
export function buildProfileText(input: ProfileTextInput): string {
  const lines: string[] = [];

  if (input.bio) lines.push(`Bio: ${singleLine(input.bio).slice(0, MAX_BIO_CHARS)}`);
  if (input.location) lines.push(`Location: ${singleLine(input.location)}`);

  const languages = Object.entries(input.topLanguages)
    .sort((a, b) => b[1] - a[1])
    .map(([name, share]) => `${name} ${Math.round(share * 100)}%`);
  if (languages.length > 0) lines.push(`Languages (share of code in own repositories): ${languages.join(", ")}`);

  if (input.topics.length > 0) lines.push(`Repository topics: ${input.topics.join(", ")}`);

  return lines.length > 0 ? lines.join("\n") : "No public profile information available.";
}

/** Removes emails, phone numbers and links that people write into their About text. */
function stripContactDetails(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (match) => (match.replace(/\D/g, "").length >= 7 ? "" : match));
}

/**
 * Builds the plain-text profile for a LinkedIn candidate, in the same line format as buildProfileText
 * (so the AI prompt, the embeddings and the offline Quick score all read it the same way).
 * Headline + summary go on the "Bio" line, skills on "Skills", experience on "Experience".
 */
export function buildLinkedInProfileText(input: LinkedInProfileTextInput): string {
  const lines: string[] = [];

  const bio = [input.headline, input.summary].filter((part): part is string => !!part).map(stripContactDetails).map(singleLine).join(". ");
  if (bio) lines.push(`Bio: ${bio.slice(0, MAX_BIO_CHARS)}`);
  if (input.location) lines.push(`Location: ${singleLine(input.location)}`);
  if (input.experienceYears !== null) lines.push(`Experience: ${input.experienceYears} years`);
  if (input.skills.length > 0) lines.push(`Skills: ${input.skills.map(singleLine).join(", ")}`);

  return lines.length > 0 ? lines.join("\n") : "No public profile information available.";
}

/** What a Google result tells us about a LinkedIn profile (see SerpCandidate). */
export interface SerpProfileTextInput {
  headline: string | null;
  location: string | null;
  snippet: string;
}

/** Google's LinkedIn boilerplate: "500+ connections", "View X's profile on LinkedIn, a professional community of ...". */
function stripSnippetBoilerplate(snippet: string): string {
  return snippet
    .replace(/\bView\b.{0,80}?\bprofile on LinkedIn\b.*$/i, " ")
    .replace(/\b\d[\d,]*\+?\s+(?:connections|followers)\b(?:\s+on LinkedIn)?/gi, " ")
    .replace(/\u2026|\.{3}/g, " ");
}

/**
 * Builds the plain-text profile for a candidate known only from a Google result (same line format as the others,
 * so scoring and re-scoring read it the same way). Emails, links and phone numbers are removed: contact data is for
 * the recruiter only. Date ranges ("2019 - 2023") are kept, because the scorer uses them for recency.
 */
export function buildSerpProfileText(input: SerpProfileTextInput): string {
  const clean = (text: string): string =>
    singleLine(
      stripIndianMobiles(stripSnippetBoilerplate(text))
        .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ")
        .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
        // other phone formats: 10+ digits in a row (a date range has at most 8)
        .replace(/\+?\d[\d\s().-]{8,}\d/g, (match) => (match.replace(/\D/g, "").length >= 10 ? " " : match)),
    );

  const lines: string[] = [];
  const headline = input.headline ? clean(input.headline).slice(0, 200) : "";
  const bio = clean(input.snippet).slice(0, MAX_BIO_CHARS * 2);
  if (headline) lines.push(`Headline: ${headline}`);
  if (bio) lines.push(`Bio: ${bio}`);
  if (input.location) lines.push(`Location: ${singleLine(input.location)}`);

  return lines.length > 0 ? lines.join("\n") : "No public profile information available.";
}

/** Builds the job text the AI scores against. */
export function buildJobText(job: JobTextInput): string {
  const list = (items: string[]): string => (items.length > 0 ? items.join(", ") : "none listed");

  return [
    `Title: ${singleLine(job.title)}`,
    `Required skills: ${list(job.requiredSkills)}`,
    `Preferred skills: ${list(job.preferredSkills)}`,
    `Languages: ${list(job.languages)}`,
    `Location: ${list(job.locations)}`,
    `Remote allowed: ${job.remoteAllowed ? "yes" : "no"}`,
    `Description: ${job.description.trim()}`,
  ].join("\n");
}
