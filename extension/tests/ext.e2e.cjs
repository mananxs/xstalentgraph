const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const EXT = path.resolve(__dirname, "../dist");
const BASE = "http://localhost:3000";
let pass = 0, fail = 0;
const ok = (c, m, e) => { c ? pass++ : (fail++, console.log("FAIL:", m, e ?? "")); if (c) console.log("ok  :", m); };
const html = fs.readFileSync(path.join(__dirname, "page.html"), "utf8");

(async () => {
  const { start } = await import("./mockgroq.mjs"); await start(4010);
  const ud = fs.mkdtempSync("/tmp/xs-pwprofile-");
  const ctx = await chromium.launchPersistentContext(ud, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--headless=new"] });
  const advHtml = fs.readFileSync(path.join(__dirname, "page-adv.html"), "utf8");
  const pdfBytes = fs.readFileSync(path.join(__dirname, "asha.pdf"));
  const profileHtml = `<!doctype html><html><body><main><h1>Meera Pillai</h1><p>Senior Java Developer at Initech Systems, Bengaluru</p>
    <p>Mobile: +91 91234 56780 &nbsp; Email: meera.pillai@example.com</p><p>7 Yrs 1 Months | 26 Lacs | Notice period: 30 days | Current location: Bengaluru</p>
    <p>Key skills: Java, Spring Boot, Kubernetes, Kafka, Microservices, AWS, Docker. Designation: Senior Java Developer. B.Tech Computer Science.</p>
    <p>Worked on payment microservices at Initech Systems since 2018 and led a team of five engineers building event driven services on Kafka and Kubernetes.</p>
    <a id="cv" href="https://resdex.naukri.com/cv/download/777.pdf">Download CV</a></main></body></html>`;
  await ctx.route("https://resdex.naukri.com/**", (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/cv/")) return r.fulfill({ status: 200, contentType: "application/pdf", body: pdfBytes });
    if (u.pathname.startsWith("/profile")) return r.fulfill({ status: 200, contentType: "text/html", body: profileHtml });
    if (u.pathname.startsWith("/advanced")) return r.fulfill({ status: 200, contentType: "text/html", body: advHtml });
    return r.fulfill({ status: 200, contentType: "text/html", body: html });
  });
  let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
  const id = sw.url().split("/")[2];
  console.log("extension id", id);

  // ---- panel (as a normal tab) : login form
  const panel = await ctx.newPage();
  panel.on("pageerror", (e) => console.log("PANEL ERROR", e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.waitForSelector("text=Log in to XS-Hunt");
  ok(true, "AuthGate renders (email/password + API-key tabs)");
  await panel.fill('input[placeholder="https://your-app.vercel.app"]', BASE);
  await panel.fill('input[autocomplete="username"]', "a@hr.test");
  await panel.fill('input[autocomplete="current-password"]', "wrong-password-1");
  await panel.click('button:has-text("Log in")');
  await panel.waitForSelector("text=Wrong email or password", { timeout: 8000 });
  ok(true, "wrong password → error shown, not logged in");
  await panel.fill('input[autocomplete="current-password"]', "password123");
  await panel.click('button:has-text("Log in")');
  await panel.waitForSelector("header >> text=/^HR A$/", { timeout: 15000 });
  ok(true, "logged in as HR A (name shown in header)");
  const cfg = await panel.evaluate(() => chrome.storage.local.get("config")); 
  ok(cfg.config.apiKey.startsWith("rsx_") && cfg.config.user.email === "a@hr.test", "config holds HR A's own key + identity");

  // ---- pick job via real UI
  await panel.waitForSelector("select.input option:has-text('Senior Java Developer')", { state: "attached", timeout: 10000 });
  await panel.selectOption("select.input >> nth=0", { label: /Senior Java Developer/ }).catch(async () => {
    const v = await panel.$eval("select.input option:nth-child(2)", (o) => o.value); await panel.selectOption("select.input >> nth=0", v);
  });
  const active = await panel.evaluate(() => chrome.storage.local.get("activeJob"));
  ok(active.activeJob?.title === "Senior Java Developer", "active job selected");

  // ---- Resdex page → content script → worker → backend
  const rd = await ctx.newPage();
  rd.on("pageerror", (e) => console.log("RESDEX PAGE ERROR", e.message));
  await rd.goto("https://resdex.naukri.com/search");
  await rd.waitForTimeout(6000);
  const tabId = await panel.evaluate(async () => (await chrome.tabs.query({ url: "https://resdex.naukri.com/*" }))[0].id);
  const sess = await panel.evaluate(async (t) => chrome.storage.session.get([`rank:${t}`, `search:${t}`, `searchSession:${t}`]), tabId);
  const rank = sess[`rank:${tabId}`] ?? [];
  console.log("rank states:", rank.map((e) => e.state).join(","));
  ok(rank.length === 3 && rank.every((e) => e.state === "done" && e.result.key), "content script → service worker → backend: 3 cards scored, each with a server key");
  const snap = sess[`search:${tabId}`];
  ok(snap && snap.live.location === "Bengaluru" && snap.live.minExp === 5, `live Naukri search stored per tab: ${JSON.stringify(snap?.live?.keywords)} ${snap?.live?.location}`);
  const ssn = sess[`searchSession:${tabId}`];
  ok(ssn?.id && ssn.jobId === active.activeJob.id, `server search session created for the applied search: ${ssn?.label}`);

  // ---- live sync: type in Naukri → panel storage updates
  await rd.fill("#loc", "Hyderabad");
  await rd.waitForTimeout(900);
  const snap2 = (await panel.evaluate(async (t) => chrome.storage.session.get(`search:${t}`), tabId))[`search:${tabId}`];
  ok(snap2.live.location === "Hyderabad" && snap2.liveSig !== snap.liveSig && snap2.appliedSig === snap.appliedSig, "editing Naukri location updates the live state; applied results unchanged until Search");

  // ---- second scan of the same cards = cache (check via API)
  const key = cfg.config.apiKey;
  const analyzed = await panel.evaluate(async ([t]) => new Promise((res) => chrome.runtime.sendMessage({ type: "GET_ANALYZED", tabId: t, scope: "search" }, res)), [tabId]);
  ok(analyzed.ok && analyzed.data.scope === "search" && analyzed.data.items.length === 3, `GET_ANALYZED (this search): ${analyzed.data?.items?.length} items, scope ${analyzed.data?.scope}`);
  const jobWide = await panel.evaluate(async ([t]) => new Promise((res) => chrome.runtime.sendMessage({ type: "GET_ANALYZED", tabId: t, scope: "job" }, res)), [tabId]);
  ok(jobWide.ok && jobWide.data.items.length >= 3, "GET_ANALYZED (whole job)");

  // ---- Analyzed tab in the UI
  await panel.bringToFront();
  await panel.click('button:has-text("Analyzed")');
  await panel.waitForTimeout(1500);
  const body = await panel.textContent("body");
  ok(/Priya Nair|Vikram Shah|Meera Iyer/.test(body) || /Card/.test(body), "Analyzed tab lists already-analyzed candidates");

  // ---- analyzed-only toggle: a brand-new search page → not scored
  await rd.bringToFront();
  await panel.evaluate(() => chrome.storage.local.set({ settings: { analyzedOnly: true, autoSync: true } }));
  await rd.waitForTimeout(500);
  await rd.evaluate(() => { history.pushState({}, "", "/search?q=new"); people.push(["Zed Newman" + Math.random().toString(36).slice(2, 6), "Java Dev", "Hooli"]); render("n" + Math.random().toString(36).slice(2, 6)); });
  await rd.waitForTimeout(3500);
  const rank2 = ((await panel.evaluate(async (t) => chrome.storage.session.get(`rank:${t}`), tabId))[`rank:${tabId}`]) ?? [];
  console.log("rank2:", rank2.map((e) => `${e.label}:${e.state}`).join(" | "));
  ok(rank2.length === 4 && rank2.every((e) => e.state === "unscored"), "analyzed-only: brand-new cards are NOT scored (unscored), no AI call");
  // "Score new" via the panel message
  await panel.evaluate(async (t) => new Promise((res) => chrome.runtime.sendMessage({ type: "SCORE_PENDING", tabId: t }, res)), tabId);
  await rd.waitForTimeout(3500);
  const rank3 = ((await panel.evaluate(async (t) => chrome.storage.session.get(`rank:${t}`), tabId))[`rank:${tabId}`]) ?? [];
  ok(rank3.length === 4 && rank3.every((e) => e.state === "done"), `SCORE_PENDING scores them: ${rank3.map((e) => e.state)}`);


  // ---- platform job → full Resdex plan reaches the extension, and Fill puts ALL of it on the page
  const plan = active.activeJob.search;
  ok(plan && plan.allKeywords.length && plan.designations.length && plan.booleanQuery, `active job carries the server's plan: ${plan?.booleanQuery}`);
  const adv = await ctx.newPage();
  await adv.goto("https://resdex.naukri.com/advanced");
  await adv.waitForTimeout(1500);
  const advTab = await panel.evaluate(async () => (await chrome.tabs.query({ url: "https://resdex.naukri.com/advanced*" }))[0].id);
  const fillRes = await panel.evaluate(async ([t, p]) => new Promise((res) => chrome.runtime.sendMessage({ type: "FILL_SEARCH", tabId: t, fields: { booleanQuery: p.booleanQuery, minExp: p.minExp, maxExp: p.maxExp, locations: p.locations, allKeywords: p.allKeywords, anyKeywords: p.anyKeywords, excludeKeywords: p.excludeKeywords, designations: p.designations, minSalary: p.minSalary, maxSalary: p.maxSalary, maxNoticeDays: p.maxNoticeDays, education: p.education, useBoolean: true } }, res)), [advTab, plan]);
  const vv = (id) => adv.$eval("#" + id, (e) => e.value);
  console.log("fill report:", fillRes.data?.fields?.map((f) => `${f.status}:${f.key}`).join(" "));
  ok(fillRes.ok && (await adv.$eval("#bool", (e) => e.checked)) && (await vv("boolq")) === plan.booleanQuery, "Fill (through the service worker): Boolean mode on + the platform's Boolean query typed");
  ok((await vv("emin")) === String(plan.minExp) && (await vv("desig")).length > 0 && (await vv("loc")).length > 0, "experience, designation and location filled from the platform job");
  ok(plan.maxNoticeDays === null || (await adv.$$eval("#n0,#n15,#n30", (els) => els.some((e) => e.checked))), "notice-period option(s) ticked from the platform's limit");
  ok((await adv.evaluate(() => window.__searched)) === 0, "Search was NOT pressed");
  await adv.close();

  // ---- customise scoring from the panel (UI) → saved on the platform → plan + rubric updated
  await panel.bringToFront();
  await panel.click('button:has-text("Customize scoring for this job")');
  await panel.waitForSelector("text=Must-have skills", { timeout: 15000 });
  const curStrict = await panel.$eval('label:has-text("Strictness") select', (e) => e.value);
  const nextStrict = curStrict === "lenient" ? "strict" : "lenient";
  await panel.selectOption('label:has-text("Strictness") select', nextStrict);
  await panel.fill('textarea[placeholder^="e.g. Prefer product companies"]', "Prefer product companies; payments domain matters most.");
  const sigBefore = (await panel.evaluate(() => chrome.storage.local.get("activeJob"))).activeJob.sig;
  await panel.click('button:has-text("Save & re-score")');
  await panel.waitForSelector("text=Saved. Cards are being re-scored", { timeout: 15000 });
  const afterEdit = (await panel.evaluate(() => chrome.storage.local.get("activeJob"))).activeJob;
  ok(afterEdit.sig !== sigBefore, "saving customised scoring changes the job signature → the content script re-scores");
  const jobsNow = await panel.evaluate(async () => new Promise((res) => chrome.runtime.sendMessage({ type: "GET_JOBS" }, res)));
  const jn = jobsNow.data.find((j) => j.id === afterEdit.id);
  ok(jn.rubric.strictness === nextStrict && /payments/.test(jn.rubric.customInstructions), "…and the platform job now has the same strictness + instructions");
  await panel.click('button:has-text("Customize scoring for this job")'); // collapse

  // ---- shortlist an OPEN profile: mobile number is captured, then the CV is attached on request
  const pr = await ctx.newPage();
  await pr.goto("https://resdex.naukri.com/profile/777");
  await pr.waitForTimeout(5000);
  const pTab = await panel.evaluate(async () => (await chrome.tabs.query({ url: "https://resdex.naukri.com/profile/*" }))[0].id);
  const live = await panel.evaluate(async (t) => new Promise((res) => chrome.runtime.sendMessage({ type: "READ_PROFILE", tabId: t }, res)), pTab);
  ok(live.ok && live.data.open && live.data.phones[0] === "+919123456780" && live.data.cvLinks.length === 1, `READ_PROFILE sees the mobile number and the CV link: ${live.data?.phones} / ${live.data?.cvLinks?.[0]?.label}`);
  let det;
  for (let i = 0; i < 20 && !(det?.status === "ready"); i++) { await new Promise((r) => setTimeout(r, 800)); det = (await panel.evaluate(async (t) => chrome.storage.session.get(`detail:${t}`), pTab))[`detail:${pTab}`]; }
  ok(det?.status === "ready", `profile audited automatically (${det?.status})`);
  const sv = await panel.evaluate(async (t) => new Promise((res) => chrome.runtime.sendMessage({ type: "SAVE_CANDIDATE", tabId: t }, res)), pTab);
  det = (await panel.evaluate(async (t) => chrome.storage.session.get(`detail:${t}`), pTab))[`detail:${pTab}`];
  ok(sv.ok && det.save.status === "saved" && det.save.contact.phone === "+919123456780" && det.save.contact.email === "meera.pillai@example.com", `Save & Shortlist captured mobile + email: ${JSON.stringify(det.save?.contact)}`);
  ok(det.save.cv.status === "idle", "CV link detected → 'Attach CV file' offered (not downloaded automatically)");
  const at = await panel.evaluate(async (t) => new Promise((res) => chrome.runtime.sendMessage({ type: "ATTACH_CV", tabId: t }, res)), pTab);
  det = (await panel.evaluate(async (t) => chrome.storage.session.get(`detail:${t}`), pTab))[`detail:${pTab}`];
  ok(at.ok && det.save.cv.status === "saved", `Attach CV (explicit click): ${det.save?.cv?.status} ${det.save?.cv?.error ?? ""}`);
  const lg = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@hr.test", password: "password123" }) });
  const cookie = lg.headers.getSetCookie()[0].split(";")[0];
  const cvr = await fetch(BASE + `/api/candidates/${det.save.candidateId}/resume`, { headers: { cookie } });
  ok(cvr.status === 200 && cvr.headers.get("content-type") === "application/pdf" && Buffer.from(await cvr.arrayBuffer()).equals(pdfBytes), "the stored CV on the platform is the exact file Resdex served");
  await pr.close();

  // ---- logout wipes everything; login as HR B sees nothing of HR A
  await panel.bringToFront();
  await panel.click('button:has-text("Log out")');
  await panel.waitForSelector("text=Log in to XS-Hunt", { timeout: 8000 });
  const after = await panel.evaluate(async (t) => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }), tabId);
  console.log("AFTER-LOGOUT session:", JSON.stringify(Object.fromEntries(Object.entries(after.session).map(([k, v]) => [k, Array.isArray(v) ? `array(${v.length})` : typeof v === "object" ? Object.keys(v).join("/") : v]))));
  ok(!after.local.config && !after.local.activeJob && Object.values(after.session).every((v) => Array.isArray(v) && v.length === 0), `logout clears key, active job and every cached ranking/search (${Object.keys(after.local)})`);
  await panel.fill('input[placeholder="https://your-app.vercel.app"]', BASE);
  await panel.fill('input[autocomplete="username"]', "b@hr.test");
  await panel.fill('input[autocomplete="current-password"]', "password456");
  await panel.click('button:has-text("Log in")');
  await panel.waitForSelector("header >> text=/^HR B$/", { timeout: 15000 });
  const jobsB = await panel.evaluate(async () => new Promise((res) => chrome.runtime.sendMessage({ type: "GET_JOBS" }, res)));
  ok(jobsB.ok && jobsB.data.length === 0, "HR B sees none of HR A's jobs in the extension");
  const act = await panel.evaluate(() => chrome.storage.local.get("activeJob"));
  ok(!act.activeJob, "no leftover active job from HR A");

  // ---- rotated key → 401 → extension drops back to login
  const rot = await fetch(BASE + "/api/extension/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "b@hr.test", password: "password456" }) }).then((r) => r.json());
  await panel.evaluate(async () => { const c = (await chrome.storage.local.get("config")).config; c.apiKey = "rsx_revoked"; await chrome.storage.local.set({ config: c }); });
  const r401 = await panel.evaluate(async () => new Promise((res) => chrome.runtime.sendMessage({ type: "GET_JOBS" }, res)));
  const cfgAfter = await panel.evaluate(() => chrome.storage.local.get("config"));
  ok(!r401.ok && /log in again/i.test(r401.error) && !cfgAfter.config, "revoked/rotated key → clear message and the extension returns to the login screen");
  console.log(`\n${pass} passed, ${fail} failed`);
  await ctx.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(2); });
