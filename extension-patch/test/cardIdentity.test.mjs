import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { after, before, describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [execSync("npm root -g").toString().trim(), process.cwd()] }));
const here = new URL(".", import.meta.url);

let server, browser, page, base;
before(async () => {
  server = createServer((req, res) => {
    const file = req.url === "/" ? "fixture.html" : req.url.replace("/src/", "../src/");
    try {
      res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : "text/html");
      res.end(readFileSync(new URL(file, here)));
    } catch { res.statusCode = 404; res.end(); }
  }).listen(0);
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(base + "/");
});
after(async () => { await browser.close(); server.close(); });

const readAll = () => page.evaluate(async () => {
  const mod = await import("/src/cardIdentity.js");
  return mod.readAllCards(document, { rootSelector: ".tuple" }).map(({ root, ...card }) => card);
});

describe("cardIdentity", () => {
  it("reads each card's OWN name and never the open profile's name on its neighbours", async () => {
    const cards = await readAll();
    assert.deepEqual(cards.map((c) => c.name), ["Santhosh Kumar", "Vibhuti Goel", "Pooja Jaiswar", "Pooja Nair"]);
    assert.equal(cards[0].current, "DevOps Engineer at Aptly Tech");
    assert.equal(cards[1].current, "Technical Solution Manager at Coralogix");
  });

  it("gives every person a different key, even without a profile id", async () => {
    const cards = await readAll();
    assert.equal(new Set(cards.map((c) => c.key)).size, cards.length);
    assert.equal(cards[0].idSource, "naukri-id");
    assert.equal(cards[2].idSource, "hash");
  });

  it("collapses the same person rendered twice", async () => {
    const cards = await readAll();
    assert.equal(cards.filter((c) => c.name === "Santhosh Kumar").length, 1);
  });

  it("auto-detects card roots from profile links when no rootSelector is set", async () => {
    const names = await page.evaluate(async () => {
      const mod = await import("/src/cardIdentity.js");
      return mod.readAllCards(document).map((c) => c.name);
    });
    assert.ok(names.includes("Santhosh Kumar") && names.includes("Vibhuti Goel"));
    assert.ok(!names.every((n) => n === "Pooja Jaiswar"));
  });

  it("refuses to reuse an analysis made for another person", async () => {
    const ok = await page.evaluate(async () => {
      const mod = await import("/src/cardIdentity.js");
      const [a, b] = mod.readAllCards(document, { rootSelector: ".tuple" });
      const store = mod.createAnalysisStore();
      store.set("jd1", a, { score: 88 });
      return { own: store.get("jd1", a)?.score, other: store.get("jd1", b), forged: store.get("jd1", { ...b, key: a.key }) };
    });
    assert.equal(ok.own, 88);
    assert.equal(ok.other, null);
    assert.equal(ok.forged, null);
  });
});
