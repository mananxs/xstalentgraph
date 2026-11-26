import { scoreCandidate, type ScoringJob } from "@/server/ai/heuristic";
import { describeAiError, getLlmClient } from "@/server/ai/llm";
import { createLogger } from "@/server/logger";
import type { JobDetails } from "@/server/repositories/jobRepository";
import { extractContacts } from "./contacts";
import { parseCard, parseCtcLpa, parseNotice } from "./cardParse";
import type { Audit, CardResult, Worth } from "./types";

const log = createLogger("ext-scoring");

export function scoringJob(job: JobDetails): ScoringJob {
  return {
    title: job.title,
    description: job.description,
    requiredSkills: [...new Set([...job.requiredSkills, ...job.languages])],
    preferredSkills: job.preferredSkills,
    languages: job.languages,
    locations: job.locations,
    remoteAllowed: job.remoteAllowed,
    experienceYears: job.experienceYears,
    seniority: job.seniority,
  };
}

/** Text in the layout the scorer reads (Headline / Location / Skills / Experience), plus the raw card as free text. */
function profileTextOf(parsed: ReturnType<typeof parseCard>, rawText: string): string {
  return [
    parsed.headline && `Headline: ${parsed.headline}`,
    parsed.location && `Location: ${parsed.location}`,
    parsed.skills.length > 0 && `Skills: ${parsed.skills.join(", ")}`,
    parsed.expYears >= 0 && `Experience: ${parsed.expYears} years`,
    `Bio: ${rawText.replace(/\s+/g, " ").slice(0, 2500)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const tierOf = (score: number) => (score >= 80 ? "Strong fit" : score >= 60 ? "Good fit" : score >= 40 ? "Partial fit" : "Weak fit");

export function worthOf(score: number, mustHaveCoverage: number): Worth {
  if (score >= 75 && mustHaveCoverage >= 0.5) return "open";
  if (score >= 55) return "review";
  return "skip";
}

const join = (items: string[], max = 3) => items.slice(0, max).join(", ");

function verdictOf(score: number, matched: string[], missing: string[]): string {
  if (matched.length === 0) return missing.length ? `No evidence of ${join(missing, 2)} on the card.` : "Not enough on the card to judge.";
  const strength = `${score >= 75 ? "Strong" : score >= 55 ? "Decent" : "Partial"} ${join(matched)} fit`;
  return missing.length ? `${strength}; lacks ${join(missing, 2)}.` : `${strength}.`;
}

/** Scores ONE card. Offline and deterministic (the same weighted model as the rest of TalentGraph), so cards can never be mixed up. */
export function scoreCard(job: JobDetails, domId: string, rawText: string): CardResult {
  const parsed = parseCard(rawText);
  const match = scoreCandidate(scoringJob(job), profileTextOf(parsed, rawText), { model: "naukri-card" });
  const worth = worthOf(match.score, match.mustHaveCoverage);
  const reasons: string[] = [];
  const needed = job.experienceYears && job.experienceYears > 0 ? job.experienceYears : null;
  if (parsed.expYears >= 0 && needed) reasons.push(`${parsed.expYears} yrs vs ${needed}+ needed`);
  if (parsed.noticeDays >= 0) reasons.push(`Notice ${parsed.noticePeriod}`);
  reasons.push(`${Math.round(match.mustHaveCoverage * 100)}% of must-have skills shown`);
  return {
    domId,
    confidence: parsed.skills.length >= 3 ? "high" : "medium",
    score: match.score,
    tier: tierOf(match.score),
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
    noticePeriod: parsed.noticePeriod,
    noticeDays: parsed.noticeDays,
    ctc: parsed.currentCtcLpa >= 0 ? `${parsed.currentCtcLpa} LPA` : "Not mentioned",
    oneLineVerdict: verdictOf(match.score, match.matchedSkills, match.missingSkills),
    worth,
    worthReasons: reasons,
    extracted: {
      fullName: parsed.fullName,
      currentRole: parsed.currentRole,
      currentCompany: parsed.currentCompany,
      headline: parsed.headline,
      skills: parsed.skills,
      expYears: parsed.expYears,
      currentCtcLpa: parsed.currentCtcLpa,
      expectedCtcLpa: -1,
      location: parsed.location,
    },
  };
}

const fit = (ok: boolean | null, risk: boolean): "good" | "ok" | "risk" | "unknown" => (ok === null ? "unknown" : risk ? "risk" : ok ? "good" : "ok");

/** Deep audit of an opened profile: deterministic score and notes; the AI (when configured) only improves the wording. */
export async function auditProfile(job: JobDetails, rawText: string): Promise<Audit> {
  const parsed = parseCard(rawText);
  const contacts = extractContacts(rawText);
  const match = scoreCandidate(scoringJob(job), profileTextOf(parsed, rawText.slice(0, 9000)), { model: "naukri-profile" });
  const needed = job.experienceYears && job.experienceYears > 0 ? job.experienceYears : null;
  const years = parsed.expYears;
  const expectedMatch = /expected(?: ctc)?[:\s₹]*([\d.]+)\s*(?:lacs?|lakhs?|lpa)/i.exec(rawText);
  const notice = parseNotice(rawText);

  const audit: Audit = {
    extracted: {
      fullName: parsed.fullName,
      currentRole: parsed.currentRole,
      currentCompany: parsed.currentCompany,
      totalExpYears: years,
      currentCtcLpa: parseCtcLpa(rawText),
      expectedCtcLpa: expectedMatch ? Number(expectedMatch[1]) : -1,
      noticePeriod: notice.label,
      noticeDays: notice.days,
      location: parsed.location,
      email: contacts.emails[0] ?? "",
      phone: contacts.phones[0] ?? "",
    },
    score: match.score,
    tier: tierOf(match.score),
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
    strengths: [
      match.matchedSkills.length ? `Evidence of ${join(match.matchedSkills, 5)}` : "",
      match.breakdown.impact >= 50 ? "Describes measurable achievements" : "",
      years >= 0 && needed && years >= needed ? `${years} years of experience (needs ${needed}+)` : "",
    ].filter(Boolean),
    risks: [
      match.missingSkills.length ? `No evidence of ${join(match.missingSkills, 4)}` : "",
      years >= 0 && needed && years < needed ? `Only ${years} years against ${needed}+ needed` : "",
      notice.days > 60 ? `Long notice period (${notice.label})` : "",
    ].filter(Boolean),
    noticeFit: fit(notice.days < 0 ? null : notice.days <= 30, notice.days > 60),
    noticeNote: notice.days < 0 ? "Notice period not stated on the profile." : notice.days <= 30 ? `${notice.label}: can join quickly.` : `${notice.label}: plan for the wait.`,
    ctcFit: "unknown",
    ctcNote: "No CTC budget is set for this job, so the fit cannot be judged.",
    experienceNote: years < 0 ? "Experience not stated." : needed ? `${years} years against ${needed}+ required.` : `${years} years of experience.`,
    interviewQuestions: [
      ...match.matchedSkills.slice(0, 2).map((skill) => `Walk me through the hardest ${skill} problem you solved in your last role.`),
      ...match.missingSkills.slice(0, 2).map((skill) => `How have you worked with ${skill}, or what would you need to get productive in it?`),
    ].slice(0, 4),
    verdict: verdictOf(match.score, match.matchedSkills, match.missingSkills),
  };

  const llm = getLlmClient();
  if (llm.configured) {
    try {
      // Contact details never reach the model.
      const safe = rawText.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, " ").replace(/(\+?\d[\d\s-]{8,}\d)/g, " ").slice(0, 6000);
      const { data } = await llm.generateJson({
        prompt: `Job: ${job.title}\nRequired skills: ${job.requiredSkills.join(", ")}\n\nCandidate profile (no contact details):\n${safe}\n\nAnswer as JSON: {"verdict": "one sentence", "strengths": ["..."], "risks": ["..."], "interview_questions": ["..."]}. Be specific and honest; use only facts in the profile.`,
        temperature: 0.2,
        maxOutputTokens: 1024,
      });
      const ai = data as { verdict?: unknown; strengths?: unknown; risks?: unknown; interview_questions?: unknown };
      const list = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 6) : []);
      if (typeof ai.verdict === "string" && ai.verdict.trim()) audit.verdict = ai.verdict.trim().slice(0, 400);
      if (list(ai.strengths).length) audit.strengths = list(ai.strengths);
      if (list(ai.risks).length) audit.risks = list(ai.risks);
      if (list(ai.interview_questions).length) audit.interviewQuestions = list(ai.interview_questions);
    } catch (error) {
      log.warn({ reason: describeAiError(error).slice(0, 160) }, "AI wording unavailable; using the offline audit");
    }
  }
  return audit;
}
