import { stripIndianMobiles } from "@/server/sourcing/phone";
import type { CutshortHit } from "./client";

const MAX_RESUME_CHARS = 3000;

const singleLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Plain-text profile for a Cutshort hit, in the same line format every other source uses, so the weighted
 * scorer and the AI review read it the same way. Work history goes on separate lines because the scorer reads
 * date ranges per line to weigh recent roles more. Names and contacts are not here (search hits have none).
 */
export function buildCutshortProfileText(hit: CutshortHit): string {
  const resume = singleLine(
    stripIndianMobiles(hit.resumeText)
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ")
      .replace(/https?:\/\/\S+|www\.\S+/gi, " "),
  ).slice(0, MAX_RESUME_CHARS);

  const lines: string[] = [];
  const headline = hit.workHistory[0] ?? hit.currentCompany;
  if (headline) lines.push(`Headline: ${singleLine(headline).slice(0, 200)}`);
  if (hit.currentLocation) lines.push(`Location: ${singleLine(hit.currentLocation)}`);
  if (hit.experienceYears !== null) lines.push(`Experience: ${hit.experienceYears} years`);
  for (const role of hit.workHistory) lines.push(`Work: ${singleLine(role).slice(0, 200)}`);
  for (const school of hit.education.slice(0, 2)) lines.push(`Education: ${singleLine(school).slice(0, 160)}`);
  if (hit.signals.length > 0) lines.push(`Profile signals: ${hit.signals.join("; ")}`);
  if (resume) lines.push(`Bio: ${resume}`);

  return lines.length > 0 ? lines.join("\n") : "No public profile information available.";
}
