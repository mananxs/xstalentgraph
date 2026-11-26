const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
let pass = 0, fail = 0;
const ok = (c, m, e) => { c ? pass++ : (fail++, console.log("FAIL:", m, e ?? "")); if (c) console.log("ok  :", m); };
const srv = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end(fs.readFileSync(path.join(__dirname, "page-adv.html"))); }).listen(4021);
const PLAN = { booleanQuery: '(Java OR "Spring Boot") AND (Kubernetes OR K8s) NOT (Intern)', minExp: 5, maxExp: 9, locations: ["Bengaluru", "Pune"], allKeywords: ["Java", "Kubernetes"], anyKeywords: ["Kafka", "Spring Boot"], excludeKeywords: ["Intern"], designations: ["Senior Java Developer", "Backend Engineer"], minSalary: null, maxSalary: 40, maxNoticeDays: 30, education: "B.Tech", useBoolean: true };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.addInitScript(() => {
    window.__listeners = [];
    window.chrome = { runtime: { lastError: null, sendMessage(m, cb) { setTimeout(() => cb && cb({ ok: false, code: "NOT_CONFIGURED" }), 1); }, onMessage: { addListener(fn) { window.__listeners.push(fn); } } }, storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } } };
  });
  await page.goto("http://localhost:4021/");
  await page.addScriptTag({ path: path.resolve(__dirname, "../dist/content.js") });
  const send = (msg) => page.evaluate((m) => new Promise((res) => { let done = false; window.__listeners.forEach((fn) => { const r = fn(m, {}, (x) => { done = true; res(x); }); }); setTimeout(() => !done && res("no-response"), 4000); }), msg);

  // ---- Boolean mode ON: one Boolean box, query typed, everything else too
  const rep = await send({ type: "FILL_RESDEX_SEARCH", fields: PLAN });
  console.log(rep.fields.map((f) => `${f.status}:${f.key}`).join(" "));
  const v = (id) => page.$eval("#" + id, (e) => e.value);
  ok(await page.$eval("#bool", (e) => e.checked), "Boolean switch turned ON");
  ok((await v("boolq")) === PLAN.booleanQuery, "full Boolean query typed into the Boolean box");
  ok((await v("emin")) === "5" && (await v("emax")) === "9", "experience min/max");
  ok((await v("smax")) === "40" && (await v("smin")) === "", "max salary (LPA) only");
  ok((await v("loc")) === "Bengaluru" && (await v("ploc")) === "", "CURRENT location typed (not preferred); second city reported as manual");
  ok((await v("desig")) === "Senior Java Developer", "designation typed");
  ok((await v("edu")) === "B.Tech", "education typed");
  const notices = await page.$$eval("#n0,#n15,#n30,#n60,#n90", (els) => els.map((e) => e.checked));
  ok(JSON.stringify(notices) === JSON.stringify([true, true, true, false, false]), `notice ≤ 30 days → Immediate, 15 days, 1 month ticked: ${notices}`);
  ok(rep.filled.boolean && rep.filled.keywords && rep.filled.minExp && rep.filled.maxExp && rep.filled.maxSalary && rep.filled.notice && rep.filled.designation, "report marks the fields as filled");
  ok(rep.fields.find((f) => f.key === "location").status === "manual" && rep.notes.some((n) => /Pune/.test(n)), "multi-city location reported as manual with a note");
  ok((await page.evaluate(() => window.__searched)) === 0, "never pressed Search");

  // ---- Boolean mode OFF (toggle absent / user opted out): separate boxes
  await page.reload(); await page.addScriptTag({ path: path.resolve(__dirname, "../dist/content.js") });
  const rep2 = await send({ type: "FILL_RESDEX_SEARCH", fields: { ...PLAN, useBoolean: false } });
  ok(!(await page.$eval("#bool", (e) => e.checked)), "useBoolean=false leaves the switch alone");
  ok((await v("kwall")) === "Java, Kubernetes" && (await v("kwany")) === "Kafka, Spring Boot" && (await v("kwex")) === "Intern", "all / any / exclude boxes filled separately");
  ok(rep2.fields.some((f) => f.key === "anyKeywords" && f.status === "filled"), "report lists any/exclude boxes");

  // ---- page with NO Boolean toggle and ONE keyword box → query goes in that box, missing toggle is reported not fatal
  await page.evaluate(() => { document.getElementById("bool").closest(".mode").remove(); document.getElementById("kwany").closest("label").remove(); document.getElementById("kwex").closest("label").remove(); const k = document.getElementById("kwall"); k.id = "kwmain"; k.placeholder = "Enter keywords or boolean"; k.closest("label").firstChild.textContent = "Keywords "; });
  const rep3 = await send({ type: "FILL_RESDEX_SEARCH", fields: PLAN });
  ok((await v("kwmain")) === PLAN.booleanQuery, "no toggle + single box → Boolean query typed into the keyword box");
  ok(rep3.fields.find((f) => f.key === "boolean")?.status === "missing", "missing Boolean switch is reported");

  // ---- form map diagnostic carries labels but never typed values
  const map = await send({ type: "MAP_FORM" });
  ok(map.controls.length > 8 && !JSON.stringify(map).includes("Senior Java Developer"), "form map lists controls without typed values");
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})();
