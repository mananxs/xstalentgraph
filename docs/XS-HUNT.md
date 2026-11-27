# XS-Hunt: architecture, protocol and setup

XS-Hunt (formerly TalentGraph) is the recruiter's workspace. The Chrome extension is the browser-side engine that works inside the
recruiter's own signed-in Naukri Resdex session. They talk over HTTPS through the platform, never directly.

## Flow

```
 Recruiter (XS-Hunt web)                Platform (Next.js + Postgres)                 Extension (Chrome, MV3)
 ───────────────────────                ─────────────────────────────                 ───────────────────────
 Find Candidates ─────────────▶ task + filters + rubric version saved
 Check session / Apply filters ▶ command queued (idempotent messageId) ◀── heartbeat every ~15-30 s ─── "I see: signed_in"
                                 command delivered in the heartbeat answer ─────────▶ ack ──▶ execute in the Resdex tab
                                 task shows ONLY what is reported back  ◀──────────── result: per-field applied / failed / ...
 Start sourcing ──────────────▶ desired state saved + command ──────────▶ page agent reads cards, clicks "Next" (paced)
                                 capture (idempotent per task+card)  ◀──────────────── cards of each page (outbox if offline)
 Start AI analysis ───────────▶ AI queue (independent state) ── 7-dimension evaluation ── CandidateEvaluation (+rubric version)
 Select + approve credit warning ▶ retrieval request ─────────────────▶ opens ONE profile at a time, saves profile + CV file
 Review profile / resume in XS-Hunt (stored in the platform, audited)
```

Honest states: "connected" only while the last heartbeat is under 45 s old; the Naukri state is what the extension last SAW (never a
cookie); a filter is "applied" only after the extension read the value back from the Naukri form.

## Persistence and recovery
* Platform: tasks, commands, events, the capture queue and the AI queue are database rows. Commands the extension acknowledged but never
  finished are offered again after 2 minutes (same `messageId`).
* Extension (`chrome.storage.local`): `agent.run` (current run, page, counters), `agent.processed` (finished commands and their results:
  a re-delivered command is answered from memory, never executed twice), `agent.outbox` (pages that could not be delivered),
  `agent.retrieval` (profile retrieval progress). A browser restart, killed service worker or network failure resumes from these.

## Extension API (`/api/extension/*`, `Authorization: Bearer <personal key>`)
| Route | Purpose |
| --- | --- |
| `POST login`, `GET me` | email + password -> personal key (only its SHA-256 is stored) |
| `GET/POST jobs` | jobs with rubric + Resdex search plan; ad-hoc job from a pasted JD |
| `POST score-batch`, `score-profile`, `GET analyzed`, `POST search-session` | manual-mode scoring with the same 7-dimension engine |
| `POST import-candidate`, `POST candidates/:id/resume` | save a card / opened profile; upload a CV file |
| `POST agent/heartbeat` | pulse + Naukri state; returns commands, desired states |
| `POST agent/commands/:id/ack`, `.../result` | acknowledge, then report what really happened |
| `POST agent/events` | progress / warnings / errors / self-pause |
| `POST agent/capture` | cards of one result page (idempotent) |

Commands: `check_session`, `apply_filters`, `start_sourcing`, `pause_sourcing`, `resume_sourcing`, `stop_sourcing`, `retrieve_profiles`.

## Web API (session cookie)
`/api/hunt/connection`, `/api/jobs/:id/hunt/tasks`, `/api/hunt/tasks/:id` (+ `/commands`, `/sourcing`, `/ai`, `/ai/run`),
`/api/hunt/retrievals`, `/api/jobs/:id/candidates`, `/api/jobs/:id/rubric`, `/api/jobs/:id/compare`, `/api/matches/:id` (stage, shortlist,
override, notes, interviews, reminders), `/api/talent-pool`, `/api/dashboard`, `/api/analytics`, `/api/team`, `/api/candidates/:id/resume`.

## Database (migration `20261128000000_xs_hunt`)
New: `candidate_sources`, `candidate_resumes`, `evaluation_rubrics`, `candidate_evaluations`, `pipeline_events`, `candidate_notes`,
`interviews`, `reminders`, `extension_connections`, `sourcing_tasks`, `sourcing_commands`, `task_events`, `captured_candidates`,
`retrieval_requests`. Added columns: `candidates.primarySource/sources/organizationId/fullProfile`, `match_scores.stage/tier/override*/...`,
`recruiters.role`. The migration backfills existing data (sources normalised, organizations, resumes, stages, admins) and keeps the
pgvector indexes.

## Scoring
One engine: the 7-dimension evaluator (`src/server/hunt/evaluate.ts`): skills, experience, compensation, availability, location, education,
career background, plus custom criteria. Each dimension is `confirmed`, `mismatch`, `missing` (excluded from the score) or `skipped`
(the rubric sets no requirement). Tiers: Strong (75+), Potential (55-74), Weak, Provisional (<70% of the rubric had data), Needs More Info
(<40%). Recruiter overrides keep the AI result and require a reason.

## Setup
1. `npm install`, set `.env` (see `.env.example`), `npx prisma migrate deploy`, create a user: `npm run user:create -- you@co.com "Name" "password"`.
2. Extension: `cd extension && npm install && npm run build`, load `extension/dist` in `chrome://extensions` (Developer mode).
3. Open the extension panel, enter the XS-Hunt address, log in with the same email and password.
4. In XS-Hunt: open a job, Find Candidates, Naukri. Sign in to Resdex in the same Chrome first.

## Limits you should know
* Naukri-specific selectors (cards, pager, session, CV link) are structural heuristics tested on fixtures, NOT on live Naukri here.
* Filters the extension cannot type into Resdex (previous designation, preferred location, company, industry, expected CTC, university) are reported `unsupported`.
* Opening a profile or CV can spend Naukri credits: it only happens for candidates you select, after a confirmation.
* Pagination automation reads result pages at a human pace; check that it is acceptable under your Naukri terms before using it at volume.
* AI analysis is the platform's rule-based 7-dimension engine (no LLM call per candidate); the LLM is only used for wording in deep audits when keys are set.
