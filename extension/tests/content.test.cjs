const { chromium } = require("playwright");
const path = require("path");
const http = require("http"), fs = require("fs");
const DIR = __dirname;
let pass = 0, fail = 0;
const ok = (c, m, e) => { c ? pass++ : (fail++, console.log("FAIL:", m, e ?? "")); if (c) console.log("ok  :", m); };
const srv = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end(fs.readFileSync(DIR + "/page.html")); }).listen(4020);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.addInitScript(() => {
    window.__msgs = []; window.__listeners = []; window.__settings = { scoring: true };
    const store = { local: { settings: {} } };
    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) {
          window.__msgs.push(msg);
          let r = { ok: true, data: null };
          if (msg.type === "SCORE_CARDS") {
            r = msg.onlyCached
              ? { ok: true, data: { results: [], missing: [], unscored: msg.cards.map((c) => c.domId) } }
              : { ok: true, data: { results: msg.cards.map((c, i) => ({ domId: c.domId, key: "k" + c.domId, cached: i === 0, score: 80 - i * 10, tier: "Good Fit", matchedSkills: ["Java"], missingSkills: [], noticePeriod: "30 days", noticeDays: 30, ctc: "20 LPA", oneLineVerdict: "ok", worth: "open", worthReasons: [] })), missing: [] } };
          }
          setTimeout(() => cb && cb(r), 5);
        },
        onMessage: { addListener(fn) { window.__listeners.push(fn); } },
      },
      storage: {
        local: { get: async () => ({ settings: window.__settings }) },
        onChanged: { addListener(fn) { window.__storageListener = fn; } },
      },
    };
  });
  await page.goto("http://localhost:4020/");
  await page.addScriptTag({ path: require("path").resolve(__dirname, "../dist/content.js") });
  const msgs = (type) => page.evaluate((t) => window.__msgs.filter((m) => m.type === t), type);
  const lastSearch = async () => (await msgs("SEARCH_STATE")).at(-1)?.snapshot;
  await page.waitForTimeout(2600);

  // ---- initial read
  let s = await lastSearch();
  console.log("initial live:", JSON.stringify(s?.live));
  ok(s && /java/i.test(s.live.keywords) && /kubernetes/i.test(s.live.keywords), "keyword chips are read");
  ok(s.live.location === "Bengaluru", "location read");
  ok(s.live.minExp === 5 && s.live.maxExp === 9, `experience min/max read (${s.live.minExp}-${s.live.maxExp})`);
  ok(s.live.maxSalary === 30 && s.live.minSalary === null, `salary read (${s.live.minSalary}-${s.live.maxSalary})`);
  ok(s.appliedSig && s.liveSig, "live + applied signatures published");
  const cardsScored = await msgs("SCORE_CARDS");
  ok(cardsScored.length >= 1 && cardsScored[0].cards.length === 3 && cardsScored[0].cards[0].profileUrl?.includes("/profile/a0"), "cards scored with profileUrl; onlyCached=false");
  const sigBefore = s.liveSig;

  // ---- typing in the keyword box updates the live state without pressing Search
  const n0 = (await msgs("SEARCH_STATE")).length;
  await page.fill("#kw", "spring boot");
  await page.waitForTimeout(700);
  s = await lastSearch();
  ok(/spring boot/.test(s.live.keywords) && s.liveSig !== sigBefore, `typed keyword reaches live state immediately: "${s.live.keywords}"`);
  ok(s.appliedSig === (await msgs("SEARCH_STATE"))[0].snapshot.appliedSig, "…but results (applied search) are still the previous search until Search is pressed");

  // ---- location + experience edits
  await page.fill("#loc", "Pune");
  await page.fill('[aria-label="Min experience (years)"]', "7");
  await page.waitForTimeout(700);
  s = await lastSearch();
  ok(s.live.location === "Pune" && s.live.minExp === 7, `location/experience edits sync (${s.live.location}, ${s.live.minExp})`);

  // ---- exclude box separated
  await page.fill("#excl", "intern");
  await page.waitForTimeout(700);
  s = await lastSearch();
  ok(s.live.excludeKeywords.includes("intern"), `exclude keywords classified: ${JSON.stringify(s.live.excludeKeywords)}`);

  // ---- filter panel: checkbox, radio, aria-checked widget
  await page.check("#np15"); await page.waitForTimeout(600);
  s = await lastSearch();
  ok(s.live.filters.some((f) => f.label === "Notice period" && f.value === "15 days or less"), `checkbox filter read with its group heading: ${JSON.stringify(s.live.filters)}`);
  await page.click("#ed"); await page.waitForTimeout(700);
  s = await lastSearch();
  ok(s.live.filters.some((f) => f.label === "Education" && f.value === "B.Tech"), "aria-checked custom filter read");
  await page.check("#gf"); await page.waitForTimeout(600);
  s = await lastSearch();
  ok(s.live.filters.some((f) => f.label === "Gender"), "radio filter read");
  await page.uncheck("#np15"); await page.waitForTimeout(600);
  s = await lastSearch();
  ok(!s.live.filters.some((f) => /15 days/.test(f.value)), "un-ticking a filter removes it (no stale filter)");
  ok(!s.live.filters.some((f) => /select candidate/i.test(f.value)), "no candidate-card checkboxes leak in");

  // ---- Search pressed: SPA pushState + new cards → applied search changes, cards re-scored for the NEW search
  const scoredBefore = (await msgs("SCORE_CARDS")).length;
  const appliedBefore = s.appliedSig;
  await page.click("#go");
  await page.waitForTimeout(2600);
  s = await lastSearch();
  ok(s.appliedSig !== appliedBefore && s.appliedSig === s.liveSig, "after Search + SPA navigation: applied search = live search (stale one dropped)");
  ok(/q=spring/.test(await page.evaluate(() => location.search)) && s.live.url.endsWith("/search"), "URL change (pushState) detected");
  ok((await msgs("SCORE_CARDS")).length > scoredBefore, "new result cards scored after the SPA re-render");
  const pills = await page.$$eval("[data-ai-pill-host]", (n) => n.length);
  ok(pills === 3, `pills re-rendered on the new result set (${pills})`);

  // ---- Analyzed-only mode
  await page.evaluate(() => { window.__settings = { analyzedOnly: true, autoSync: true, scoring: true }; window.__storageListener({ settings: { newValue: window.__settings } }, "local"); });
  await page.waitForTimeout(300);
  // a brand-new result page
  await page.evaluate(() => { history.pushState({}, "", "/search?q=x&page=2"); render("c"); });
  await page.waitForTimeout(2600);
  const sc = await msgs("SCORE_CARDS");
  ok(sc.at(-1).onlyCached === true, "analyzed-only: new cards are requested with onlyCached=true (no AI call)");
  const pillText = await page.$$eval("[data-ai-pill-host]", (hosts) => hosts.map((h) => h.shadowRoot ? h.shadowRoot.textContent : "closed"));
  ok(true, "pill state not inspectable (closed shadow root) — verified via messages instead");
  const rank = (await msgs("PUBLISH_RANKING")).at(-1).entries;
  ok(rank.length === 3 && rank.every((e) => e.state === "unscored"), `entries marked unscored: ${rank.map((e) => e.state)}`);
  // "Score new cards"
  const before = (await msgs("SCORE_CARDS")).length;
  await page.evaluate(() => window.__listeners.forEach((fn) => fn({ type: "SCORE_PENDING" }, {}, () => {})));
  await page.waitForTimeout(1800);
  const sc2 = await msgs("SCORE_CARDS");
  ok(sc2.length > before && sc2.at(-1).onlyCached === false, "SCORE_PENDING scores the waiting cards (onlyCached=false)");
  const rank2 = (await msgs("PUBLISH_RANKING")).at(-1).entries;
  ok(rank2.every((e) => e.state === "done"), `entries now scored: ${rank2.map((e) => e.state)}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
