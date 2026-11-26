// Start/Stop gating + "same name on different cards" protection, against the real dist/content.js.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
let pass = 0, fail = 0;
const ok = (c, m, e) => { c ? pass++ : (fail++, console.log("FAIL:", m, e ?? "")); if (c) console.log("ok  :", m); };
const srv = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end(fs.readFileSync(path.join(__dirname, "page.html"))); }).listen(4022);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.addInitScript(() => {
    window.__msgs = []; window.__listeners = []; window.__settings = {}; // default = STOPPED
    window.__badBatch = false;
    const result = (c, name, company) => ({ domId: c.domId, score: 80, tier: "Good Fit", matchedSkills: ["Java"], missingSkills: [], noticePeriod: "30 days", noticeDays: 30, ctc: "20 LPA", oneLineVerdict: "v " + name, worth: "open", worthReasons: [], extracted: { fullName: name, currentRole: "x", currentCompany: company, headline: "", skills: [], expYears: 6, currentCtcLpa: 20, expectedCtcLpa: -1, location: "Bengaluru" } });
    const nameOf = (c) => /Priya Nair|Vikram Shah|Meera Iyer/.exec(c.rawText)?.[0] ?? "Unknown";
    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) {
          window.__msgs.push(JSON.parse(JSON.stringify(msg)));
          let r = { ok: true, data: null };
          if (msg.type === "SCORE_CARDS") {
            if (msg.onlyCached) r = { ok: true, data: { results: [], missing: [], unscored: msg.cards.map((c) => c.domId) } };
            // BAD batch: the scorer describes the FIRST person for every card of a multi-card request (the reported bug).
            else if (window.__badBatch && msg.cards.length > 1) r = { ok: true, data: { results: msg.cards.map((c) => result(c, "Pooja Jaiswar", "Capgemini")), missing: [] } };
            else r = { ok: true, data: { results: msg.cards.map((c) => result(c, nameOf(c), /Acme|Globex|Initech/.exec(c.rawText)?.[0] ?? "")), missing: [] } };
          }
          setTimeout(() => cb && cb(r), 5);
        },
        onMessage: { addListener(fn) { window.__listeners.push(fn); } },
      },
      storage: { local: { get: async () => ({ settings: window.__settings }) }, onChanged: { addListener(fn) { window.__storageListener = fn; } } },
    };
    window.__setSettings = (s) => { window.__settings = s; window.__storageListener({ settings: { newValue: s } }, "local"); };
  });
  await page.goto("http://localhost:4022/");
  await page.addScriptTag({ path: path.resolve(__dirname, "../dist/content.js") });
  const msgs = (t) => page.evaluate((x) => window.__msgs.filter((m) => m.type === x), t);
  const lastRank = async () => (await msgs("PUBLISH_RANKING")).at(-1)?.entries ?? [];
  await page.waitForTimeout(2600);

  // ---- STOPPED (default): nothing reaches the AI
  let sc = await msgs("SCORE_CARDS");
  ok(sc.length >= 1 && sc.every((m) => m.onlyCached === true), "stopped: every scoring request is cache-only (no AI call)");
  ok((await lastRank()).every((e) => e.state === "unscored"), "stopped: cards wait as 'unscored'");

  // ---- START
  await page.evaluate(() => window.__setSettings({ scoring: true }));
  await page.waitForTimeout(1500);
  sc = await msgs("SCORE_CARDS");
  ok(sc.at(-1).onlyCached === false, "start: cards are sent for scoring");
  let rank = await lastRank();
  ok(rank.length === 3 && rank.every((e) => e.state === "done"), "start: all 3 cards scored", JSON.stringify(rank.map((e) => [e.state, e.error])));
  ok(rank.map((e) => e.result.extracted.fullName).join() === "Priya Nair,Vikram Shah,Meera Iyer", "each card keeps its OWN name", rank.map((e) => e.result?.extracted?.fullName));

  // ---- STOP again: new cards are not scored
  await page.evaluate(() => window.__setSettings({ scoring: false }));
  const before = (await msgs("SCORE_CARDS")).length;
  await page.click("#go"); // SPA re-render with different people ("… b")
  await page.waitForTimeout(2600);
  const after = (await msgs("SCORE_CARDS")).slice(before);
  ok(after.length >= 1 && after.every((m) => m.onlyCached === true), "stopped again: the next search is NOT sent to the AI");

  // ---- the reported bug: scorer answers every card of a batch with ONE person
  await page.evaluate(() => { window.__badBatch = true; window.__setSettings({ scoring: true }); });
  await page.waitForTimeout(2500);
  rank = await lastRank();
  const names = rank.filter((e) => e.state === "done").map((e) => e.result.extracted.fullName);
  ok(!names.includes("Pooja Jaiswar"), "a result describing another candidate is never shown", JSON.stringify(rank.map((e) => [e.state, e.result?.extracted?.fullName])));
  ok(rank.length === 3 && rank.every((e) => e.state === "done" && e.rawText.includes(e.result.extracted.fullName)), "mismatching cards were re-scored on their own and now match their card");
  const singles = (await msgs("SCORE_CARDS")).filter((m) => m.cards.length === 1 && m.onlyCached === false);
  ok(singles.length >= 3, `suspicious cards were retried one at a time (${singles.length} single requests)`);

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
