import { scoreCandidate, type ScoringJob } from "@/server/ai/heuristic";
import { describeAiError, getLlmClient } from "@/server/ai/llm";
import { createLogger } from "@/server/logger";
import type { JobDetails } from "@/server/repositories/jobRepository";
import { extractContacts } from "./contacts";
import { parseCard, parseCtcLpa, parseNotice } from "./cardParse";
import type { Audit, CardResult, Worth } from "./types";
import { evaluateCandidate, type EvaluationResult } from "@/server/hunt/evaluate";
import { isAiEngine, judgeCandidate } from "@/server/hunt/aiJudge";
import { factsFromParsed } from "@/server/hunt/facts";
import type { ActiveRubric } from "@/server/hunt/store";
import { TIER_LABEL, type Tier } from "@/server/hunt/stages";

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

const WORTH_OF: Record<Tier, Worth> = { strong: "open", potential: "review", weak: "skip", provisional: "review", needs_info: "review" };
const join = (items: string[], max = 3) => items.slice(0, max).join(", ");

function verdictOf(r: EvaluationResult): string {
  const lead = r.matchedSkills.length ? `${r.band === "strong" ? "Strong" : r.band === "potential" ? "Decent" : "Partial"} ${join(r.matchedSkills)} fit` : r.missingSkills.length ? `No evidence of ${join(r.missingSkills, 2)}` : "Not enough shown to judge";
  const tail = r.missingSkills.length && r.matchedSkills.length ? `; lacks ${join(r.missingSkills, 2)}` : "";
  const note = r.tier === "provisional" || r.tier === "needs_info" ? ` (${TIER_LABEL[r.tier]}: ${r.missingInfo.slice(0, 3).join(", ") || "limited data"} not shown)` : "";
  return `${lead}${tail}.${note}`;
}

/** Scores ONE card with the offline rule engine (the fallback, and what tests use). */
export function scoreCard(job: JobDetails, rubric: ActiveRubric, domId: string, rawText: string): CardResult {
  const parsed = parseCard(rawText);
  const r = evaluateCandidate(scoringJob(job), rubric.data, factsFromParsed(parsed, rawText));
  return cardResultOf(parsed, r, domId, verdictOf(r), "rules");
}

/** Scores ONE card: the AI judges it against the JD and rubric (one card per call, so cards can never be mixed up); rules if no AI. */
export async function scoreCardAi(job: JobDetails, rubric: ActiveRubric, domId: string, rawText: string): Promise<CardResult> {
  const parsed = parseCard(rawText);
  const judged = await judgeCandidate({ ...scoringJob(job), description: job.description }, rubric.data, factsFromParsed(parsed, rawText), {});
  return cardResultOf(parsed, judged.result, domId, judged.summary || verdictOf(judged.result), isAiEngine(judged.engine) ? "ai" : "rules");
}

function cardResultOf(parsed: ReturnType<typeof parseCard>, r: EvaluationResult, domId: string, verdict: string, engine: "ai" | "rules"): CardResult {
  const reasons = Object.entries(r.dimensions)
    .filter(([, d]) => d.status !== "skipped")
    .map(([k, d]) => `${k.replace("custom_", "custom ")}: ${d.status}`)
    .slice(0, 6);
  return {
    domId,
    confidence: r.evidenceCoverage >= 0.7 ? "high" : r.evidenceCoverage >= 0.4 ? "medium" : "low",
    score: r.total,
    tier: TIER_LABEL[r.tier],
    matchedSkills: r.matchedSkills,
    missingSkills: r.missingSkills,
    noticePeriod: parsed.noticePeriod,
    noticeDays: parsed.noticeDays,
    ctc: parsed.currentCtcLpa >= 0 ? `${parsed.currentCtcLpa} LPA` : "Not mentioned",
    oneLineVerdict: verdict,
    scoredBy: engine,
    worth: WORTH_OF[r.tier],
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
      education: parsed.education,
      previous: parsed.previous,
      prefLocations: parsed.prefLocations,
    },
  };
}

const fit = (ok: boolean | null, risk: boolean): "good" | "ok" | "risk" | "unknown" => (ok === null ? "unknown" : risk ? "risk" : ok ? "good" : "ok");

/** Deep audit of an opened profile: deterministic score and notes; the AI (when configured) only improves the wording. */
export async function auditProfile(job: JobDetails, rubric: ActiveRubric, rawText: string): Promise<Audit> {
  const parsed = parseCard(rawText);
  const contacts = extractContacts(rawText);
  const judged = await judgeCandidate({ ...scoringJob(job), description: job.description }, rubric.data, factsFromParsed(parsed, rawText.slice(0, 20_000)), {});
  const evaluation = judged.result;
  const match = { score: evaluation.total, matchedSkills: evaluation.matchedSkills, missingSkills: evaluation.missingSkills, breakdown: { impact: evaluation.dimensions.career?.score ?? 0 } };
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
    tier: TIER_LABEL[evaluation.tier],
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
    strengths: evaluation.strengths.length ? evaluation.strengths : [
      match.matchedSkills.length ? `Evidence of ${join(match.matchedSkills, 5)}` : "",
      match.breakdown.impact >= 50 ? "Describes measurable achievements" : "",
      years >= 0 && needed && years >= needed ? `${years} years of experience (needs ${needed}+)` : "",
    ].filter(Boolean),
    risks: evaluation.concerns.length ? evaluation.concerns : [
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
    verdict: judged.summary || verdictOf(evaluation),
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
