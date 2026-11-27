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

## Database (migrations `20261128000000_xs_hunt`, `20261201000000_google_ai_keys_pairing`)
New: `candidate_sources`, `candidate_resumes`, `evaluation_rubrics`, `candidate_evaluations`, `pipeline_events`, `candidate_notes`,
`interviews`, `reminders`, `extension_connections`, `sourcing_tasks`, `sourcing_commands`, `task_events`, `captured_candidates`,
`retrieval_requests`. Added columns: `candidates.primarySource/sources/organizationId/fullProfile`, `match_scores.stage/tier/override*/...`,
`recruiters.role`. The migration backfills existing data (sources normalised, organizations, resumes, stages, admins) and keeps the
pgvector indexes.

## Scoring: the AI judges every card, the rubric defines the yardstick
**Every candidate card and profile is scored by the AI** (`src/server/hunt/aiJudge.ts`), one candidate per call, at temperature 0: it reads the JD
and the candidate's text and gives each rubric dimension a 0-100 score with a one-line reason and quoted evidence (quotes not found in the
candidate's text are dropped; an answer about a different name is refused). `null` = no evidence = missing information, not a bad score.
The total is the rubric-weighted mean of those scores, with the same must-have gate and tiers as before, so weights and targets edited in the
rubric still decide the result. Your own Groq / Gemini key is used first, then the platform's. If no AI is available, or the answer cannot be
trusted, the card is scored by the offline rule engine and **labelled "Quick score (rules)"**, never passed off as AI. A card is judged once per
rubric version (cached); a rule-scored card is retried with the AI after 10 minutes. This costs AI quota for every captured card.
It will be close to what a general chatbot says about the same CV, not identical.

The rule engine (fallback): the 7-dimension evaluator (`src/server/hunt/evaluate.ts`): skills, experience, compensation, availability, location, education,
career background, plus custom criteria. Each dimension is `confirmed`, `mismatch`, `missing` (excluded from the score) or `skipped`
(the rubric sets no requirement). Tiers: Strong (75+), Potential (55-74), Weak, Provisional (<70% of the rubric had data), Needs More Info
(<40%). Recruiter overrides keep the AI result and require a reason.

## Sign-in, roles and private data
* **Google sign-in, company accounts only.** Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (redirect URI `https://YOUR-SITE/api/auth/google/callback`).
  The server checks the e-mail Google returns: verified, and on `ALLOWED_EMAIL_DOMAIN` (default `xsassociates.com`). Anyone else is refused.
  First sign-in creates the HR (the very first person becomes admin; `ADMIN_EMAILS` / `MANAGER_EMAILS` promote listed addresses).
  E-mail + password still works next to Google unless `ALLOW_PASSWORD_LOGIN=false`.
* **Roles:** `admin` (everything + team), `manager` (sees every HR's work), `recruiter` (own work only), `viewer` (read-only, own work only).
  Add a manager in **Team & Permissions > Add a manager** with just their company e-mail; they sign in with Google.
* **Each HR's data is private.** Jobs, candidates, pipeline, shortlists, resumes, talent pool, dashboard and analytics are filtered by the job's
  creator (`src/server/access.ts`). Managers and admins see all of it. A manager can read another HR's work but cannot steer that HR's
  browser (sourcing control, filters) and only an admin or the owner can edit or delete a job.

## AI keys: your own first, the platform's as the fallback
Every HR can add a **Groq** key and a **Gemini** key in Settings (a prompt appears after the first sign-in; "Later" hides it for a day).
Keys are checked with the provider, then stored AES-256-GCM encrypted (`TOKEN_ENCRYPTION_KEY`) and never returned by any API.
For everything an HR runs (candidate scoring, JD reading, resume analysis and masking, CV OCR, GitHub sourcing scoring) the order is:
**their Groq key, their Gemini key, then the platform keys from `.env`** (`LLM_PROVIDER_ORDER` decides Groq-first or Gemini-first).
A key the provider rejects is marked *Rejected* and skipped; one that hits a rate limit or daily quota *rests* (5 min / 1 h) and is retried later;
transient errors leave it alone. Candidate scoring itself is AI-judged (see Scoring), so it uses the HR's quota first.
Code: `src/server/ai/{userKeys,scope,bind}.ts` and `TieredLlm` in `src/server/ai/llm.ts`.

## Connecting the extension (no password in the extension)
1. In XS-Hunt: **Settings > Connect extension > Create connection code** (valid 10 minutes, works once).
2. Extension side panel > **Code** tab > paste it > Connect. The code carries the site address, so that is the only thing to paste.
3. From then on the extension heartbeats (alarm every 30 s, every 5 s while a Resdex tab is open).
4. **A JD uploaded or opened in the web app becomes the extension's active job by itself** (the heartbeat hands it over); **Send to extension**
   on the job page does the same. What the HR views in Resdex is sent to that job automatically (`/api/extension/agent/auto-capture`, no AI
   spent, idempotent) and appears in the job within seconds. Turn this off with the checkbox in the panel. Start / pause / stop sourcing from
   the job page still pages through results for you.
**Load `extension/dist` only.** (An older zip had stray top-level files from a previous build: no alarms permission, so the browser never
kept a heartbeat. They are gone; the zip root is the built extension.)

## Setup
1. `npm install`, set `.env` (see `.env.example`), `npx prisma migrate deploy` (never `migrate dev`/`reset` on a live database).
2. Sign in with Google (configure it above) or create a password user: `npm run user:create -- you@xsassociates.com "Name" "password"`.
3. Extension: `cd extension && npm install && npm run build`, load `extension/dist` in `chrome://extensions` (Developer mode), then connect it (above).
4. In XS-Hunt: upload a JD, sign in to Resdex in the same Chrome, and search. Or use Find Candidates for automatic paging.

## Limits you should know
* Naukri-specific selectors (cards, pager, session, CV link) are structural heuristics tested on fixtures, NOT on live Naukri here.
* Filters the extension cannot type into Resdex (previous designation, preferred location, company, industry, expected CTC, university) are reported `unsupported`.
* Opening a profile or CV can spend Naukri credits: it only happens for candidates you select, after a confirmation.
* Pagination automation reads result pages at a human pace; check that it is acceptable under your Naukri terms before using it at volume.
* AI scoring needs an AI key (the HR's own or the platform's) and spends quota per candidate; without one, cards get the labelled rule-based Quick score. Rescoring after a rubric change re-judges up to 200 candidates per press.
