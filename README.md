# XS-Hunt

> **XS-Hunt** is a recruiting workspace: it controls sourcing from Naukri Resdex through your own signed-in browser (the XS-Hunt Chrome
> extension), scores candidates on a seven-dimension rubric, keeps approved profiles and original resumes, and runs an eleven-stage ATS
> pipeline. **Architecture, protocol, setup and limits: [docs/XS-HUNT.md](docs/XS-HUNT.md).** The extension source is in `extension/`.
>
> Quick start: `npm install`, `.env` from `.env.example` (add the Google client id/secret for company sign-in), `npx prisma migrate deploy`,
> `npm run dev`; then `cd extension && npm install && npm run build`, load **`extension/dist`** in Chrome and connect it from Settings > Connect extension.
> New in this version: Google sign-in for `@xsassociates.com`, private data per HR with manager / admin visibility, per-HR Groq + Gemini keys
> (used before the platform key), automatic JD hand-off to the extension, and a dark / light / warm theme switch.

AI-assisted developer sourcing. A recruiter opens a job, the app searches GitHub for matching developers
using **public profile metadata only** (bio, location, account age, languages, repository topics),
and Gemini scores each candidate against the job. Ranked "match cards" appear in a dashboard.
It never reads code, commits, or file contents.

One Next.js app. No Python, no separate backend, no Redis. A small worker process (same repo) does the slow work.

```
Browser  ->  Next.js (pages + /api routes)  ->  Neon Postgres (+ pgvector)
                                                     ^
                 npm run worker  (polls queued batches, calls GitHub + Gemini)
```

## Run it in GitHub Codespaces

### 1. Get three free credentials

| What | Where |
| --- | --- |
| Neon Postgres | https://neon.tech -> create a project. In **Connect**, copy the connection string twice: once with **Connection pooling ON** (host contains `-pooler`) and once with it **OFF**. |
| GitHub token | https://github.com/settings/tokens -> *Tokens (classic)* -> generate with **no scopes ticked**. |
| Gemini key | https://aistudio.google.com/apikey |

### 2. Install and configure

```bash
npm install
cp .env.example .env
openssl rand -base64 32      # copy the output into TOKEN_ENCRYPTION_KEY in .env
```

Edit `.env`: `DATABASE_URL`, `DIRECT_URL`, `TOKEN_ENCRYPTION_KEY`, `GEMINI_API_KEY`, `GITHUB_PAT`.
`GEMINI_API_KEY` is optional (without it everything still works with Quick scores and the offline JD parser).

**LinkedIn sourcing (India)** needs only `APIFY_API_TOKEN`. A run generates Google X-Ray micro-queries
(city x title x skill), reads name / LinkedIn URL / snippet from the results, extracts Indian mobile numbers from
the snippets with a regex (free), and scores every candidate with the offline weighted heuristic (free). Only
candidates scoring 75%+ (`ENRICHMENT_MIN_SCORE`) with no phone found are sent to Apollo (`APOLLO_API_KEY`), at most
`ENRICHMENT_MAX_PER_BATCH` (default 25) per run. Optional tuning: `APIFY_QUERIES_PER_RUN` (10),
`APIFY_MAX_PAGES_PER_QUERY` (1), `XRAY_MAX_QUERIES` (60), `APIFY_GOOGLE_SEARCH_ACTOR`.
After a run, the AI (Groq first with `LLM_PROVIDER_ORDER=groq,gemini`, Gemini as backup) reviews the best
`AI_RESCORE_TOP_N` (default 30) candidates against the full job description, five per call, and judges real role fit.
**Cutshort** (optional): set `CUTSHORT_API_KEY` and LinkedIn runs also search Cutshort's Indian talent database. Search hits
carry about 4,000 characters of resume text, so they are scored well for free. After scoring and the AI review, contact
details are unlocked only for the best matches (`ENRICHMENT_MIN_SCORE`, at most `CUTSHORT_MAX_UNLOCKS_PER_RUN` per run,
each one an irreversible Cutshort credit). `CUTSHORT_MAX_SEARCHES_PER_RUN` (default 3 pages of 20) limits searches.
Run `npx prisma migrate deploy` to add the `phone` and `cutshortId` columns.
Optional free backup AI: `GROQ_API_KEY`.

### 3. Create the tables and seed data

```bash
npx prisma migrate dev       # applies every migration in prisma/migrations
npx prisma db seed           # org, recruiter, encrypted GitHub token, sample job; prints the job ID
```

If `migrate dev` complains about the shadow database or extension permissions, use `npx prisma migrate deploy` instead.

### 4. Start the app

```bash
npm run dev
```

The background worker starts inside the dev server. (`npm run worker` still works as a separate process, e.g. in
production with `EMBEDDED_WORKER=false` on the web server; running both is safe.)

Open port 3000: Codespaces shows a notification, or open the **Ports** tab, find **3000**, click the globe icon.
Keep the port private.

### 5. Use it

1. Open the forwarded URL. The sample job "Senior Python backend engineer" is selected.
2. Press **Find candidates**. The worker (terminal 2) logs each step; the page shows progress and cards appear as they are scored.
3. Filter with the **Minimum score** slider, search with the box (press `/` to focus), and press **Shortlist** on cards you like.

First run tip: the free Gemini tier is slow and limited. The default is 50 profiles per run
(`DEFAULT_MAX_PROFILES` in `src/hooks/useIngestion.ts`); lower it to test faster.

## Checks you can run

| Command | What it proves |
| --- | --- |
| `/api/health` in the browser | database connected, pgvector installed, seed ran |
| `npm test` | unit tests (GitHub client, Gemini matcher, embeddings, retry logic) with no internet needed |
| `npm run github:smoke` | real GitHub search for the seeded job; prints a few profiles |
| `npm run typecheck` | TypeScript strict check |

## How the pipeline works

`POST /api/jobs/:id/ingest` creates a **queued** batch and returns 202 at once. The worker then runs a **stream**,
not a list of big steps, so you see results while it is still working:

1. claims the batch (`UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`), so two workers never share one;
2. first re-queues candidates left over from earlier runs (failed or never scored);
3. searches GitHub **10 users at a time** (one search per job location), reading public metadata only;
4. after each page: upserts the candidates (`INSERT ... ON CONFLICT`), creates `pending` rows (the dashboard shows them
   straight away as "Scoring"), and starts scoring them while the next page is fetched;
5. embeds candidates in the background (`gemini-embedding-001`, 1536 dimensions, L2-normalised); this never blocks scoring;
6. scores with Gemini, `EVAL_CONCURRENCY` at a time (default 2). If the main model is overloaded (503/429) or retired (404),
   the matcher switches to the next model in `LLM_FALLBACK_MODELS` and skips the bad one for a minute;
7. marks the batch `completed`, or `failed` with the error text if every scoring call failed.

In the dashboard, cards re-rank by themselves as scores arrive, each scored card shows its rank, and failed candidates stay
visible with a **Retry failed** button (scores them again without searching GitHub). Already-scored candidates are never
re-scored, so re-runs do not cost Gemini calls again.

Scoring uses only three factors: skill overlap (50), tech-stack alignment (30), location (20, full marks if remote is allowed).
Name, photo, gender, age, account age and follower counts are never sent to the model.

## API

All routes need a signed-in recruiter (`DEV_AUTH=true` uses the seeded one) and check the job belongs to the recruiter's organization.

| Route | Purpose |
| --- | --- |
| `GET /api/jobs` | jobs with scored-candidate counts |
| `POST /api/jobs/:id/ingest` | queue a run (`{"maxProfiles": 50, "rescoreOnly": false}` optional). 202, or 409 if a run is already active |
| `GET /api/jobs/:id/batches` | latest run of the job |
| `GET /api/jobs/:id/batches/:batchId` | progress of one run |
| `GET /api/jobs/:id/matches?minScore=&limit=&offset=` | scored candidates best first, then candidates still scoring, then failed ones (one joined query) |
| `PATCH /api/jobs/:id/matches/:matchId` | `{"shortlisted": true}` |
| `GET /api/health` | database and pgvector check |

Real login (Auth.js with GitHub) plugs in at one marked place: `src/server/auth.ts`.

## Database notes

- `DATABASE_URL` is the **pooled** Neon host (`-pooler`, with `pgbouncer=true`). The app and worker use it at runtime.
- `DIRECT_URL` is the **direct** host. Prisma uses it for migrations only.
- Tables are snake_case (`match_scores`), columns are camelCase. In raw SQL quote columns: `m."jobId"`.
- Ids are generated by Postgres (`gen_random_uuid()`). Raw `UPDATE`s must set `"updatedAt" = now()` themselves.
- Tokens are stored as `v1:<iv>:<tag>:<ciphertext>` (AES-256-GCM). Changing `TOKEN_ENCRYPTION_KEY` makes stored tokens unreadable: re-run the seed.
- Migration `20261104000000_init` also contains hand-written SQL (score CHECK constraints, HNSW cosine indexes).

## Contact enrichment

Design only, no code: see `docs/ENRICHMENT.md`. Legal review comes first.

## Troubleshooting

**`Can't reach database server` / SSL errors**
- Both URLs must end with `sslmode=require`. Neon computes sleep when idle, so the first connection can take seconds: retry, keep `connect_timeout=15`.
- URL-encode special characters in the password (`@`, `:`, `/`).

**`prepared statement "s0" already exists` / random pooler errors**
- `DATABASE_URL` points at the pooler but lacks `pgbouncer=true`. Add `&pgbouncer=true`.

**`migrate` hangs, "drift detected", or a lock timeout**
- `DIRECT_URL` must be the direct host (no `-pooler`).
- Drift means the database already has tables from something else. Use a fresh Neon database/branch, or `npx prisma migrate reset` if its data is disposable.

**`permission denied to create extension "vector"` / shadow database errors**
- Use `npx prisma migrate deploy`, or run `CREATE EXTENSION IF NOT EXISTS vector;` once in the Neon SQL editor.

**The run stays "Queued"**
- The worker is not running. It starts with `npm run dev` unless `EMBEDDED_WORKER=false`; otherwise start `npm run worker`.

**Candidates show a "Quick" badge**
- The AI could not score them (the reason is shown under "Last run"). Fix the key / wait for quota, then press **Re-score with AI**.

**Gemini `503` / "high demand" / "UNAVAILABLE"**
- Google's side is busy. The app retries, then switches to `LLM_FALLBACK_MODELS` automatically. If all models are busy, candidates stay listed as "Failed": wait a minute and press **Retry failed**.
- Make sure the backup names in `.env` exist for your key (see the `curl .../v1beta/models` command in the 404 entry below).

**"Failed to fetch" banner in the browser**
- The page could not reach the dev server (it was restarting, or stopped). Check that `npm run dev` is running; background polling retries by itself and the banner clears when the server is back.

**Gemini `429` / "quota exceeded"**
- The free tier has per-minute and per-day limits. The app retries automatically with waits (and obeys Gemini's "retry in Ns" hint), so runs get slower, not broken.
- If a run still fails, wait a minute, lower `DEFAULT_MAX_PROFILES`, keep `EVAL_CONCURRENCY=2` (or 1), or set `LLM_MODEL` to another model.
- `All N evaluations failed` right at the start usually means a wrong or restricted `GEMINI_API_KEY` (HTTP 400/403): check the key in `.env`.

**Gemini `404 ... model is no longer available`**
- Google retires model names. Set `LLM_MODEL` in `.env` to a current one (this version uses `gemini-3.8-flash`) and restart `npm run worker` (env is read at start).
- To see which models your key can use: `curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" | grep '"name"'`
- Embeddings have their own setting, `EMBEDDING_MODEL` (default `gemini-embedding-001`). A failing embedding does not stop scoring; it only logs a warning.
- Failed candidates are retried automatically on the next **Find candidates** run.

**GitHub `401 Bad credentials`**
- `GITHUB_PAT` is wrong, expired or revoked. Create a new classic token with **no scopes**, update `.env`, run `npx prisma db seed`.

**GitHub rate limit messages in the worker log**
- Normal. The client reads `x-ratelimit-remaining` / `x-ratelimit-reset` and waits for the reset. Search is limited to about 30 requests/minute.

**GitHub `403` mentioning SAML / SSO**
- The token cannot see an organization that enforces SSO. Public data still works; if every query fails, try a fresh classic token.

**Never add the `email` field to the GitHub query.** It needs the `read:user` scope and breaks the whole request for scope-less tokens.

**`TOKEN_ENCRYPTION_KEY must decode to 32 bytes`**
- Generate it with `openssl rand -base64 32` (not hex, not a passphrase).

**The page shows "DEV_AUTH ... not allowed in production"**
- You started with `npm run start`. Use `npm run dev` locally, or set `DEV_AUTH=false` and add real login.
