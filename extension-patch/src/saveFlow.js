/**
 * "Save Card to Shortlist": card + analysis + resume -> platform.
 *
 * On the RESULTS LIST the CV is not on the page (opening it spends a CV view), so the card is saved immediately without
 * a file and remembered as "needs resume". The moment you open that candidate's profile (you only do that for the people
 * worth a view), `attachPendingResume()` downloads the CV and uploads it. Nothing is ever saved as a Naukri link.
 */
import { captureResume } from "./resumeCapture.js";
import { buildIdentity } from "./cardIdentity.js";

const send = (message) =>
  new Promise((resolve, reject) =>
    chrome.runtime.sendMessage(message, (reply) => (reply?.ok ? resolve(reply.data) : reject(new Error(reply?.error ?? chrome.runtime.lastError?.message ?? "No answer from the extension."))))
  );

const PENDING = "xsPendingResumes";
const readPending = async () => (await chrome.storage.local.get(PENDING))[PENDING] ?? {};
const writePending = (value) => chrome.storage.local.set({ [PENDING]: value });

export function toPayload({ card, analysis, job }) {
  return {
    job: { id: job.platformJobId ?? undefined, title: job.title, description: job.description, requiredSkills: job.requiredSkills ?? [], preferredSkills: job.preferredSkills ?? [], locations: job.locations ?? [] },
    candidate: {
      naukriId: card.key, // the identity key: stable per PERSON, so two people never merge and re-saves update
      name: card.name,
      headline: card.current,
      location: card.location,
      experienceYears: card.experienceYears,
      ctc: card.ctc,
      noticePeriod: card.noticePeriod ?? null,
      skills: card.skills,
      phones: card.phones ?? [],
      emails: card.emails ?? [],
      profileUrl: card.profileUrl,
    },
    analysis: { score: analysis.score, matchedSkills: analysis.matched ?? [], missingSkills: analysis.missing ?? [], reason: analysis.headline ?? analysis.reason ?? null },
  };
}

/** Button handler for "Save Card to Shortlist" on a list card. `onProfilePage` = the CV is on screen right now. */
export async function saveCard({ card, analysis, job, onProfilePage = false }) {
  const payload = toPayload({ card, analysis, job });
  let resume = null;
  if (onProfilePage) {
    const captured = await captureResume({ candidateName: card.name });
    resume = captured.resume;
    if (captured.resumeText) payload.resumeText = captured.resumeText;
  }
  const result = await send({ type: "XS_SAVE_SHORTLIST", shortlist: payload, resume });
  if (result.resume === "file") {
    const pending = await readPending();
    delete pending[card.key];
    await writePending(pending);
  } else {
    await writePending({ ...(await readPending()), [card.key]: { payload, savedAt: Date.now() } });
  }
  return result; // { resume: "file"|"text"|"none", resumeWarning, profilePath }
}

/**
 * Run on every profile page load. If this person was saved earlier without a file, upload the CV now.
 * `identityFacts` = the same fields the card reader uses (name, experience, current, location, ctc) read from the profile header.
 */
export async function attachPendingResume({ identityFacts, id }) {
  const pending = await readPending();
  const key = buildIdentity({ id, ...identityFacts }).key;
  const entry = pending[key] ?? Object.entries(pending).find(([, value]) => value.payload.candidate.name === identityFacts.name)?.[1];
  if (!entry) return null;
  const captured = await captureResume({ candidateName: identityFacts.name });
  if (!captured.resume) return { attached: false, reason: captured.reason };
  const payload = { ...entry.payload, resumeText: captured.resumeText ?? undefined };
  const result = await send({ type: "XS_SAVE_SHORTLIST", shortlist: payload, resume: captured.resume });
  if (result.resume === "file") {
    delete pending[payload.candidate.naukriId];
    await writePending(pending);
  }
  return { attached: result.resume === "file", result };
}
