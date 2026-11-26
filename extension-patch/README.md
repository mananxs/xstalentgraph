# XS-NaukriAI: extension patch

Your two archives contained the **TalentGraph web platform** but not the **extension's source**, so this folder is a set of
drop-in modules for the extension plus tests, not an edit of your files. Platform side is already done in the main project
(`/api/ext/*`, resume storage, candidate page).

## What each file fixes

| Your request | File | What it does |
| --- | --- | --- |
| Cards show the same name/info but click opens other people | `src/cardIdentity.js` | Reads every field from **inside one card**, gives each person a stable key (Naukri id, else hash of name+experience+role+location+CTC), de-duplicates, and refuses an analysis made for someone else. |
| Red to green Start/Stop button | `src/scoringController.js` | Nothing is scored until Start. Cards found while stopped are only counted. Stop halts at once. Always starts stopped after a reload (protects your CV quota). |
| Resume links 404 | `src/resumeCapture.js`, `src/saveFlow.js` | Never saves a Naukri link. Downloads the CV with your Resdex session, checks the bytes really are PDF/DOC (an HTML login page is rejected), uploads the file. If it cannot, sends the CV text. A card saved from the list is auto-completed with its CV when you open that profile. |
| Everything in one platform | `src/platformClient.js`, `src/background.js` | Service-worker client for `/api/ext/ping`, `/jobs`, `/shortlist`. |
| Auto fill | `src/querySync.js` | Waits for Naukri to finish rendering, mirrors the search into the query box, never overwrites what you typed (shows "differs" instead). |
| Remove "Customize scoring" | (delete, see below) | Standard weights only. |

## Why the duplicate cards happened (from your screenshots)

Ranks 6, 7, 17 and 18 all say *Pooja Jaiswar, Consulting Engineer at Capgemini*, and the open profile in your second
screenshot is Pooja Jaiswar. The reader is picking the name/headline from the **page** (the open profile) instead of the
**card**, and the analysis is cached under a key that does not include the person. Clicking works because the click uses the
card element itself. `cardIdentity.js` fixes both halves and has a test that reproduces it.

## Wire it in (about 20 minutes)

1. **Copy** `src/` into the extension (adjust import paths if you bundle). Merge `manifest.additions.json` into `manifest.json`.
2. **Cards**: replace your card reader with `readAllCards(document, { rootSelector })`. Open one card in DevTools, copy its
   container's class (for example `.tuple`) into `rootSelector` and the name element into `nameSelector`; this removes all guessing.
   Store analyses with `createAnalysisStore()`, key = JD hash + `card.key`.
3. **Start/Stop**: build the controller with your existing scorer
   `const scoring = createScoringController({ scoreCard: (card) => yourScoreFunction(card), onChange: updatePanel })`,
   call `scoring.offer(card)` for every card you detect (instead of scoring immediately), and `mountScoringToggle(panelHeader, scoring)`.
4. **Customize scoring**: delete the "CUSTOMIZE SCORING FOR THIS JOB / Edit" block and the code behind it. Keep one constant
   for the standard weights, shared by every job and recruiter. Your platform shows these weights on the landing page from
   `STANDARD_WEIGHTS` in `src/components/landing/data.ts`; set both to the same numbers.
5. **Platform tab** in the panel: two inputs (platform URL, key) saved to `chrome.storage.local` as
   `xsPlatform = { platformUrl, apiKey }`; a "Test" button sends `{type: "XS_PING"}`. The key is `EXTENSION_API_KEY` from the platform `.env`.
6. **Save Card to Shortlist** -> `saveCard({ card, analysis, job })`. Show `result.resumeWarning` when `result.resume !== "file"`.
   On profile pages call `attachPendingResume({ identityFacts, id })` once the CV has rendered.
7. **Auto fill**: `createQuerySync({ getBox, setBox, onStatus })`, then `.start()`; wire "Re-sync from Naukri" to `.forceSync()`.

## Tests

```bash
export NODE_PATH=$(npm root -g)          # Playwright is used for the DOM fixture
node --test test/*.test.mjs              # identity + controller + resume sniffing
TG_URL=http://localhost:3000 TG_KEY=<EXTENSION_API_KEY> node --test test/platform.integration.test.mjs
```

All 15 passed against a local platform (real PDF stored and served back as `application/pdf`; an HTML login page disguised as
a PDF was rejected; two people with the same name stayed separate; re-saving never wiped a stored file).

## What I could not verify

* Naukri's real Resdex DOM and CV download URL. Selectors are heuristics plus the `rootSelector`/`nameSelector` overrides;
  `findResumeUrls` tries embedded viewers and download links in turn. Send me one card's `outerHTML` and the profile page's
  "Attached CV" block and I will pin them exactly.
* Your existing extension code: the "auto fill" bug in particular is addressed generically, not from its source.
