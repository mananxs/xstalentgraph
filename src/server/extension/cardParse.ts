import { createHash } from "node:crypto";
import type { CardExtracted } from "./types";

/**
 * Reads a Resdex result card from its visible text (what the extension sends as `rawText`).
 * Pure and deterministic: every field comes from THIS text only, so one candidate's data can never end up on another card.
 */

const CITIES = ["bengaluru", "bangalore", "mumbai", "delhi", "new delhi", "ncr", "gurgaon", "gurugram", "noida", "pune", "hyderabad", "chennai", "kolkata", "ahmedabad", "jaipur", "kochi", "coimbatore", "indore", "chandigarh", "remote"];
const UI_WORDS = /^(select all|add to|set reminder|view phone number|call candidate|verified phone|save|comment|more|cv|similar profiles|modified|active|current|previous|education|key skills|pref\.? locations?|may also know|notice period|\d+ similar profiles)\b/i;
const EXP_RE = /(\d{1,2})\s*(?:y|yrs?|years?)\b\s*(?:(\d{1,2})\s*(?:m|mos?|months?)?)?/i;

const lines = (text: string) => text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);

export function parseExperience(text: string): number {
  const match = EXP_RE.exec(text);
  if (!match) return -1;
  const years = Number(match[1]) + (match[2] ? Number(match[2]) / 12 : 0);
  return Math.round(years * 10) / 10;
}

/** "₹ 12 Lacs", "12 LPA", "1.2 Cr" -> LPA. 0 / missing -> -1. */
export function parseCtcLpa(text: string): number {
  const match = /(?:₹|rs\.?)?\s*([\d]+(?:[.,]\d+)?)\s*(lacs?|lakhs?|lpa|l\b|cr(?:ores?)?)/i.exec(text);
  if (!match) return -1;
  const value = Number((match[1] ?? "").replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return -1;
  return /^cr/i.test(match[2] ?? "") ? Math.round(value * 100 * 10) / 10 : value;
}

export function parseNotice(text: string): { label: string; days: number } {
  if (/immediate|serving.*notice|available now/i.test(text) && !/notice period[:\s]*\d/i.test(text)) return { label: "Immediate", days: 0 };
  const days = /notice(?: period)?[:\s-]*(\d{1,3})\s*days?/i.exec(text);
  if (days) return { label: `${Number(days[1])} days`, days: Number(days[1]) };
  const months = /notice(?: period)?[:\s-]*(\d)\s*months?/i.exec(text);
  if (months) return { label: `${Number(months[1])} months`, days: Number(months[1]) * 30 };
  return { label: "Not mentioned", days: -1 };
}

function guessName(all: string[]): string {
  for (const line of all.slice(0, 8)) {
    if (line.length < 3 || line.length > 60 || UI_WORDS.test(line)) continue;
    if (/\d/.test(line) || /[₹|@]/.test(line)) continue;
    if (!/^[A-Za-z][A-Za-z .'-]+$/.test(line)) continue;
    if (line.split(" ").length > 5) continue;
    return line.replace(/\s+(a|b|c)$/i, "").trim();
  }
  return "";
}

function labelled(all: string[], label: RegExp): string {
  for (let i = 0; i < all.length; i++) {
    const line = all[i]!;
    const inline = new RegExp(`^(?:${label.source})\\s*[:\\-]\\s*(.+)$`, "i").exec(line);
    if (inline?.[1]) return inline[1].trim();
    if (label.test(line) && /^(?:current|previous|education|key skills?|pref\.? locations?)$/i.test(line) && all[i + 1]) return all[i + 1]!;
  }
  return "";
}

function splitRole(value: string): { role: string; company: string } {
  const cleaned = value.replace(/\s*[—–|].*$/, "").trim();
  const match = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(cleaned);
  return match ? { role: match[1]!.trim(), company: match[2]!.trim() } : { role: cleaned, company: "" };
}

function findLocation(all: string[], text: string): string {
  const current = /current location[:\s]*([A-Za-z ,/]+?)(?:\.|\s{2,}|\n|Preferred|$)/i.exec(text);
  if (current?.[1]) return current[1].replace(/\s+/g, " ").trim().split(/\s*\/\s*/)[0] ?? "";
  for (const line of all.slice(0, 14)) {
    const city = CITIES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(line) && line.length < 40 && !UI_WORDS.test(line));
    if (city) return line.replace(/\s+/g, " ").trim();
  }
  const any = CITIES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
  return any ? any[0]!.toUpperCase() + any.slice(1) : "";
}

export function parseCard(rawText: string): CardExtracted & { noticePeriod: string; noticeDays: number } {
  const all = lines(rawText);
  const text = all.join("\n");
  const name = guessName(all);
  const { role, company } = splitRole(labelled(all, /current/i) || (/([A-Z][\w &/.+-]+?\s+at\s+[A-Z][\w &.,-]+?)\s*(?:[—–|]|\n|$)/.exec(text)?.[1] ?? ""));
  const skillsText = labelled(all, /key skills?/i) || /key skills?[:\s]+(.+)/i.exec(text)?.[1] || "";
  const skills = skillsText
    .split(/\s*[|,]\s*/)
    .map((skill) => skill.trim())
    .filter((skill) => skill && skill.length < 40)
    .slice(0, 40);
  const ctcLine = all.find((line) => /₹|lacs?|lakhs?|lpa/i.test(line)) ?? "";
  const notice = parseNotice(text);
  return {
    fullName: name,
    currentRole: role,
    currentCompany: company,
    headline: [role, company].filter(Boolean).join(" at "),
    skills,
    expYears: parseExperience(all.find((line) => EXP_RE.test(line)) ?? text),
    currentCtcLpa: parseCtcLpa(ctcLine),
    expectedCtcLpa: -1,
    location: findLocation(all, text),
    noticePeriod: notice.label,
    noticeDays: notice.days,
  };
}

/** Stable identity of a card: its own profile link when it has one, otherwise a fingerprint of the normalised text. */
export function cardKey(rawText: string, profileUrl?: string | null): string {
  if (profileUrl && /^https?:/i.test(profileUrl)) {
    try {
      const url = new URL(profileUrl);
      // The link AND the name on the card: a generic link shared by several cards can never merge two different people.
      const name = parseCard(rawText).fullName.toLowerCase().replace(/[^a-z]/g, "");
      return `u_${createHash("sha1").update(`${url.origin}${url.pathname}${url.search}|${name}`).digest("hex").slice(0, 24)}`;
    } catch {
      /* fall through to the text fingerprint */
    }
  }
  const normalised = rawText.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ₹.|]/g, "").trim();
  return `t_${createHash("sha1").update(normalised).digest("hex").slice(0, 24)}`;
}
