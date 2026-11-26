# Extension tests (Playwright; needs `npm i -D playwright` or a global Playwright with Chromium)

- `content.test.cjs` — injects `dist/content.js` into a Resdex-like page (`page.html`) with a mocked `chrome` API and checks search-state sync
  (keywords/chips, location, experience, salary, filters, SPA navigation, Analyzed-only scoring).
- `ext.e2e.cjs` — loads the real `dist/` in Chromium and drives login → job → scoring → Analyzed → logout/HR switch against a RUNNING backend
  (`http://localhost:3000`, the host the manifest pre-authorises) with the mock Groq server in `mockgroq.mjs`.
  Needs HR accounts `a@hr.test` / `password123` (with an active job) and `b@hr.test` / `password456` — `../../resdexextensionweb-main/tests/e2e/e2e.mjs` creates them.
- `fill.test.cjs` — the full-field **Fill Resdex Search** (Boolean switch, all/any/exclude boxes, designation, location, experience, salary, notice options, education) on a synthetic advanced-search form (`page-adv.html`).
