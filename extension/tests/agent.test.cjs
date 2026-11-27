// Page-side sourcing agent against FIXTURE pages (a paginated Resdex-like list, a login page, a captcha page).
// This verifies the agent's logic in a real browser; it is NOT a test against live Naukri.
const { chromium } = require("playwright");
const path = require("path"), http = require("http"), fs = require("fs");
let pass = 0, fail = 0;
const ok = (c, m, e) => { c ? pass++ : (fail++, console.log("FAIL:", m, e ?? "")); if (c) console.log("ok  :", m); };
const pages = { "/": "page-paged.html", "/login": "page-login.html", "/captcha": "page-captcha.html" };
const srv = http.createServer((q, r) => { const f = pages[q.url.split("?")[0]] ?? "page-paged.html"; r.writeHead(200, { "content-type": "text/html" }); r.end(fs.readFileSync(path.join(__dirname, f))); }).listen(4031);

async function open(url, runInit) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.addInitScript((init) => {
    window.__msgs = []; window.__listeners = []; window.__store = { "agent.run": init };
    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) {
          window.__msgs.push(JSON.parse(JSON.stringify(msg)));
          let r = { ok: true, data: null };
          if (msg.type === "AGENT_CAPTURE") r = { ok: true, data: { captured: msg.cards.length, duplicates: 0, limitReached: false } };
          setTimeout(() => cb && cb(r), 5);
        },
        onMessage: { addListener(fn) { window.__listeners.push(fn); } },
      },
      storage: {
        local: {
          get: async (k) => (typeof k === "string" ? { [k]: window.__store[k] } : { ...window.__store }),
          set: async (o) => { Object.assign(window.__store, JSON.parse(JSON.stringify(o))); },
        },
        onChanged: { addListener() {} },
      },
    };
  }, runInit ?? null);
  await page.goto(url);
  await page.addScriptTag({ path: path.resolve(__dirname, "../dist/agent.js") });
  const send = (msg) => page.evaluate((m) => new Promise((res) => { let done = false; window.__listeners.forEach((fn) => { fn(m, {}, (x) => { done = true; res(x); }); }); setTimeout(() => !done && res("no-response"), 4000); }), msg);
  const msgs = (t) => page.evaluate((x) => window.__msgs.filter((m) => m.type === x), t);
  const run = () => page.evaluate(() => window.__store["agent.run"]);
  return { browser, page, send, msgs, run };
}
const RUN = (over = {}) => ({ taskId: "t1", state: "running", limits: { maxPages: 3, maxCandidates: 100, delaySeconds: 3 }, page: 1, pagesDone: 0, captured: 0, ...over });

(async () => {
  // ---- session detection from what the page shows
  for (const [u, expected] of [["http://localhost:4031/", "signed_in"], ["http://localhost:4031/login", "signed_out"], ["http://localhost:4031/captcha", "captcha"]]) {
    const t = await open(u);
    await t.page.waitForTimeout(500);
    const r = await t.send({ type: "AGENT_SESSION" });
    ok(r.session === expected, `session detected on ${u.split("4031")[1] || "/"}: ${r.session}`, JSON.stringify(r));
    await t.browser.close();
  }

  // ---- reading one page of cards + pager
  let t = await open("http://localhost:4031/");
  await t.page.waitForTimeout(600);
  const read = await t.send({ type: "AGENT_READ_CARDS" });
  ok(read.cards.length === 3 && read.page === 1 && read.hasNext === true, `reads 3 cards, page 1, a Next control (${read.cards.length}, ${read.page}, ${read.hasNext})`);
  ok(read.cards.map((c) => c.rawText.split("\n")[0]).join() === "Asha Rao,Bala Iyer,Chitra Menon", "each card keeps its own text", read.cards.map((c) => c.rawText.slice(0, 20)));
  ok(new Set(read.cards.map((c) => c.cardKey)).size === 3 && read.cards.every((c) => c.profileUrl?.includes("/profile/")), "distinct card keys and profile links");
  await t.browser.close();

  // ---- a full run: reads pages 1..3, then stops at the page limit; never opens a profile
  t = await open("http://localhost:4031/", RUN());
  await t.page.waitForTimeout(500);
  await t.send({ type: "AGENT_RUN" });
  await t.page.waitForFunction(() => window.__store["agent.run"]?.state === "completed", null, { timeout: 60000 }).catch(() => {});
  let run = await t.run();
  const caps = await t.msgs("AGENT_CAPTURE");
  ok(run.state === "completed", `run completes at the limit (state=${run.state})`);
  ok(caps.length === 3 && caps.map((c) => c.page).join() === "1,2,3", `captured pages 1,2,3 once each (${caps.map((c) => c.page)})`);
  const names = caps.flatMap((c) => c.cards.map((x) => x.rawText.split("\n")[0]));
  ok(names.length === 9 && new Set(names).size === 9, `9 different candidates, no repeats (${names.length}/${new Set(names).size})`);
  ok(new URL(t.page.url()).pathname === "/" && !t.page.url().includes("/profile/"), "no profile was opened");
  ok(run.pagesDone === 3 && run.captured === 9, `run counters persisted (${run.pagesDone} pages, ${run.captured} captured)`);
  await t.browser.close();

  // ---- pause is honoured, and resume continues without repeating a page
  t = await open("http://localhost:4031/", RUN({ limits: { maxPages: 4, maxCandidates: 100, delaySeconds: 3 } }));
  await t.page.waitForTimeout(500);
  await t.send({ type: "AGENT_RUN" });
  await t.page.waitForFunction(() => (window.__msgs.filter((m) => m.type === "AGENT_CAPTURE").length) >= 1, null, { timeout: 20000 });
  await t.page.evaluate(() => { window.__store["agent.run"].state = "paused"; });
  await t.page.waitForTimeout(6000);
  const pausedCaps = (await t.msgs("AGENT_CAPTURE")).length;
  ok(pausedCaps <= 2, `paused: no further pages read while paused (${pausedCaps})`);
  const before = (await t.msgs("AGENT_CAPTURE")).length;
  await t.page.waitForTimeout(4000);
  ok((await t.msgs("AGENT_CAPTURE")).length === before, "still paused after waiting");
  await t.page.evaluate(() => { window.__store["agent.run"].state = "running"; });
  await t.page.waitForFunction(() => window.__store["agent.run"]?.state === "completed", null, { timeout: 60000 }).catch(() => {});
  const all = await t.msgs("AGENT_CAPTURE");
  ok(new Set(all.map((c) => c.page)).size === all.length, `after resume no page is captured twice (${all.map((c) => c.page)})`);
  await t.browser.close();

  // ---- stop ends the run
  t = await open("http://localhost:4031/", RUN({ limits: { maxPages: 6, maxCandidates: 100, delaySeconds: 3 } }));
  await t.page.waitForTimeout(500);
  await t.send({ type: "AGENT_RUN" });
  await t.page.waitForFunction(() => window.__msgs.some((m) => m.type === "AGENT_CAPTURE"), null, { timeout: 20000 });
  await t.page.evaluate(() => { window.__store["agent.run"].state = "stopped"; });
  await t.page.waitForTimeout(5000);
  ok((await t.msgs("AGENT_CAPTURE")).length <= 2, "stop: reading ends");
  ok(await t.page.evaluate(() => window.__listeners.length) >= 1, "agent still responds after stop");
  const pong = await t.send({ type: "AGENT_PING" });
  ok(pong.running === false, "the loop has exited after stop");
  await t.browser.close();

  // ---- losing the session mid-run pauses and says why
  t = await open("http://localhost:4031/", RUN({ limits: { maxPages: 6, maxCandidates: 100, delaySeconds: 3 } }));
  await t.page.waitForTimeout(500);
  await t.send({ type: "AGENT_RUN" });
  await t.page.waitForFunction(() => window.__msgs.some((m) => m.type === "AGENT_CAPTURE"), null, { timeout: 20000 });
  await t.page.evaluate(() => { document.body.insertAdjacentHTML("afterbegin", "<p>Your session has expired. Please login again.</p>"); });
  await t.page.waitForFunction(() => window.__msgs.some((m) => m.type === "AGENT_RUN_STATE" && m.state === "paused"), null, { timeout: 30000 }).catch(() => {});
  const st = (await t.msgs("AGENT_RUN_STATE")).at(-1);
  ok(st?.state === "paused" && st.reason === "expired", `session loss pauses the run with the reason (${st?.state}/${st?.reason})`);
  await t.browser.close();

  // ---- a Next control that does nothing never causes a duplicate read
  t = await open("http://localhost:4031/", RUN({ limits: { maxPages: 6, maxCandidates: 100, delaySeconds: 3 } }));
  await t.page.waitForTimeout(500);
  await t.page.evaluate(() => window.__setBroken());
  await t.send({ type: "AGENT_RUN" });
  await t.page.waitForFunction(() => window.__msgs.some((m) => m.type === "AGENT_RUN_STATE"), null, { timeout: 60000 }).catch(() => {});
  const bs = (await t.msgs("AGENT_RUN_STATE")).at(-1);
  ok(bs?.state === "paused" && bs.reason === "page_did_not_change" && (await t.msgs("AGENT_CAPTURE")).length === 1, "unchanged page after Next: paused, page captured once");
  await t.browser.close();

  // ---- the candidate limit
  t = await open("http://localhost:4031/", RUN({ limits: { maxPages: 6, maxCandidates: 4, delaySeconds: 3 } }));
  await t.page.waitForTimeout(500);
  await t.page.evaluate(() => { const orig = chrome.runtime.sendMessage; chrome.runtime.sendMessage = (msg, cb) => { if (msg.type === "AGENT_CAPTURE") { window.__msgs.push(JSON.parse(JSON.stringify(msg))); const n = window.__msgs.filter((m) => m.type === "AGENT_CAPTURE").length * 3; setTimeout(() => cb({ ok: true, data: { captured: msg.cards.length, duplicates: 0, limitReached: n >= 4 } }), 5); } else orig(msg, cb); }; });
  await t.send({ type: "AGENT_RUN" });
  await t.page.waitForFunction(() => window.__store["agent.run"]?.state === "completed", null, { timeout: 60000 }).catch(() => {});
  ok((await t.msgs("AGENT_CAPTURE")).length === 2 && (await t.run()).state === "completed", "the platform's limit-reached answer stops the run");
  await t.browser.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  srv.close();
  process.exit(fail ? 1 : 0);
})();
