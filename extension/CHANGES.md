# XS-Hunt extension 2.1

* **Fixes "not connected":** the previous zip shipped an old build at its top level (no `alarms` permission, no page agent), so the browser never
  kept a heartbeat. The zip root is now the built extension itself (`manifest.json` 2.1.0 with `alarms`), nothing else.
* **Connect with a code** (Settings > Connect extension in XS-Hunt): no password in the extension, works with Google sign-in.
* **JD hand-off:** the job uploaded / opened in XS-Hunt becomes the extension's active job on the next heartbeat.
* **Auto-send:** candidates you view in Resdex are sent to that job (no AI used), unless you untick it in the panel.
* Heartbeat every 5 s while a Resdex tab is open (30 s otherwise).

# XS-Hunt extension 2.0

Controlled from XS-Hunt: connection + Naukri session detection (heartbeat), filter apply-and-verify, paced pagination capture, independent
pause/stop, credit-gated profile and CV retrieval, persistent queue/outbox, recovery after restarts. Details: ../docs/XS-HUNT.md.

New files: `src/background/agent.ts`, `src/content/agent-content.ts`, `src/content/cards.ts`, `src/sidepanel/components/AgentStatusCard.tsx`.
Load `dist/` in Chrome. Tests: `node tests/agent.test.cjs` (fixtures), `npm run test:worker` (real worker vs a running platform).

Load the extension from `dist/` (chrome://extensions -> Developer mode -> Load unpacked). The same files are also copied to the
project root, so loading the root folder works too. Rebuild with `npm run build`.

## 1. Same name / info on different cards  (fixed)
Cause: the AI scorer sometimes answered several cards of one batch with ONE candidate's name, verdict and skills, and the panel
trusted it. Now every result is checked against the card's own text (name, and company when present). A mismatching result is
never shown, cached or saved; the card is re-scored on its own, and if it still does not match it shows an error instead of
someone else's data. A stale entry left behind when Resdex re-uses a card element for a different person is also dropped.
Save is refused for a mismatching card, so a wrong person can never reach the shortlist or the platform.
Files: `src/shared/util.ts` (`resultMatchesCard`), `src/content/resdex-observer.ts`, `LiveRankingTab.tsx`, `service-worker.ts`.

## 2. Start / Stop scoring (red -> green)  (new)
Big button at the top of the panel. Red = STOPPED: no card is sent to the AI (analyzed ones still show from cache). Green =
SCORING. Pressing Stop mid-run halts at the next batch. It is forced back to red on browser start, update and login/logout.
Files: `ScoringToggle.tsx`, `Settings.scoring`.

## 3. "Customize scoring for this job" removed
Panel block, component and the `SAVE_JOB_EDITS` message are gone; scoring uses the server's standard rubric for everyone.

## 4. XS-Hunt is now the extension's ONLY backend  (new)
The extension no longer needs its old web app. Log in with your XS-Hunt email + password (panel -> Platform URL = your XS-Hunt
site), or paste a key from XS-Hunt Settings. Jobs, rubric, scoring, Analyzed, search sessions, shortlist and CV upload are all served by
XS-Hunt at `/api/extension/*`; everything you save shows up in its Pipeline and Shortlists, and each CV opens inside the platform
(`/candidates/:id`), so nothing links back to a Naukri URL that would 404. Attach CV still runs only when you press it.

## Tests
`npm run test:unit`, and with Playwright (`NODE_PATH=$(npm root -g)`): `node tests/scoring.test.cjs`, `content.test.cjs`, `fill.test.cjs`.
`TG_URL=... TG_EMAIL=... TG_PASSWORD=... npm run test:backend` runs the full contract against a live XS-Hunt.

## Not changed / open
* "Auto fill": the existing fill and auto-sync tests pass and I could not reproduce a fault from the code alone. Tell me what
  you see (what is typed where, and what you expected) and I will fix that exact case.
* A CV download can use your Resdex credit/quota; it only happens on the button press.
