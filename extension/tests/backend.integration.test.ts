// The extension's whole backend contract against a running XS-Hunt.
//   TG_URL=http://localhost:3001 TG_EMAIL=you@x.com TG_PASSWORD=... npm run test:backend
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const BASE = process.env.TG_URL ?? "";
const skip = !BASE;
const api = (path: string, key?: string, body?: unknown, method?: string) =>
  fetch(`${BASE}/api/extension${path}`, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

const JD = `Senior Site Reliability Engineer, Hyderabad. 5+ years. Must have: Kubernetes, Go, AWS, Terraform. Nice to have: Prometheus, Linux. Own reliability for a multi-region platform.`;
const santhosh = `Santhosh Kumar\n7y 0m\n₹ 12 Lacs\nHyderabad\nCurrent\nDevOps Engineer at Aptly Tech\nKey skills\nKubernetes | Terraform | AWS | Go | Linux | Prometheus`;
const vibhuti = `Vibhuti Goel\n10y 0m\n₹ 0\nNoida\nCurrent\nTechnical Solution Manager at Coralogix\nKey skills\nObservability | Sales | Presentation`;
const pooja = `Pooja Jaiswar\n6y 2m\n₹ 18 Lacs\nHyderabad\nCurrent\nConsulting Engineer at Capgemini\nKey skills\nGo | Kubernetes | AWS`;

describe("extension backend inside XS-Hunt", { skip }, () => {
  let key = "";
  let jobId = "";
  let cardUrl = "";

  it("rejects calls without a key and logs in with email + password", async () => {
    assert.equal((await api("/jobs")).status, 401);
    assert.equal((await api("/login", undefined, { email: process.env.TG_EMAIL, password: "wrong-wrong" })).status, 401);
    const res = await api("/login", undefined, { email: process.env.TG_EMAIL, password: process.env.TG_PASSWORD });
    const data = (await res.json()) as { apiKey: string; user: { email: string } };
    assert.equal(res.status, 200);
    assert.ok(data.apiKey.startsWith("tgx_"));
    key = data.apiKey;
    assert.equal(((await (await api("/me", key)).json()) as { user: { email: string } }).user.email, process.env.TG_EMAIL?.toLowerCase());
  });

  it("creates an ad-hoc job from a pasted JD and returns a rubric + Resdex plan", async () => {
    const res = await api("/jobs", key, { rawDescription: JD });
    assert.equal(res.status, 201);
    const { job } = (await res.json()) as { job: { id: string; rubric: { mustHaveSkills: string[] }; search: { booleanQuery: string }; rubricHash: string } };
    jobId = job.id;
    assert.ok(job.rubric.mustHaveSkills.length >= 3, JSON.stringify(job.rubric.mustHaveSkills));
    assert.ok(job.search.booleanQuery.length > 0);
    const list = (await (await api("/jobs", key)).json()) as { jobs: { id: string }[] };
    assert.ok(list.jobs.some((j) => j.id === jobId));
  });

  it("scores cards separately: each card keeps its own name and a sensible score", async () => {
    const res = await api("/score-batch", key, { jobId, candidates: [{ domId: "a", rawText: santhosh }, { domId: "b", rawText: vibhuti }, { domId: "c", rawText: pooja }] });
    const data = (await res.json()) as { results: { domId: string; score: number; cached?: boolean; extracted: { fullName: string }; worth: string }[]; unscored: string[] };
    assert.equal(res.status, 200);
    const by = Object.fromEntries(data.results.map((r) => [r.domId, r]));
    assert.equal(by.a!.extracted.fullName, "Santhosh Kumar");
    assert.equal(by.b!.extracted.fullName, "Vibhuti Goel");
    assert.equal(by.c!.extracted.fullName, "Pooja Jaiswar");
    assert.ok(by.a!.score > by.b!.score, `relevant candidate must outscore the irrelevant one: ${by.a!.score} vs ${by.b!.score}`);
    assert.ok(data.results.every((r) => !r.cached));
  });

  it("serves repeats from the cache and never scores new cards in onlyCached mode", async () => {
    const again = (await (await api("/score-batch", key, { jobId, candidates: [{ domId: "x", rawText: santhosh }] })).json()) as { results: { cached: boolean; extracted: { fullName: string } }[] };
    assert.equal(again.results[0]!.cached, true);
    assert.equal(again.results[0]!.extracted.fullName, "Santhosh Kumar");
    const fresh = (await (await api("/score-batch", key, { jobId, onlyCached: true, candidates: [{ domId: "n", rawText: "Someone New\n4y 0m\n₹ 8 Lacs\nPune\nCurrent\nQA at Foo" }, { domId: "s", rawText: santhosh }] })).json()) as { results: { domId: string }[]; unscored: string[] };
    assert.deepEqual(fresh.unscored, ["n"]);
    assert.deepEqual(fresh.results.map((r) => r.domId), ["s"]);
  });

  it("a shared profile link on several cards still cannot merge two people", async () => {
    cardUrl = "https://resdex.naukri.com/v3/profile";
    const res = await api("/score-batch", key, { jobId, candidates: [{ domId: "p1", rawText: santhosh, profileUrl: cardUrl }, { domId: "p2", rawText: pooja, profileUrl: cardUrl }] });
    const data = (await res.json()) as { results: { domId: string; extracted: { fullName: string } }[] };
    assert.deepEqual(data.results.map((r) => r.extracted.fullName), ["Santhosh Kumar", "Pooja Jaiswar"]);
    const again = (await (await api("/score-batch", key, { jobId, candidates: [{ domId: "p2", rawText: pooja, profileUrl: cardUrl }, { domId: "p1", rawText: santhosh, profileUrl: cardUrl }] })).json()) as { results: { domId: string; extracted: { fullName: string } }[] };
    assert.deepEqual(Object.fromEntries(again.results.map((r) => [r.domId, r.extracted.fullName])), { p2: "Pooja Jaiswar", p1: "Santhosh Kumar" });
  });

  it("links scores to a search session and lists them as analyzed", async () => {
    const s = (await (await api("/search-session", key, { jobId, signature: "sig-1", state: { keywords: "Go Kubernetes", location: "Hyderabad", minExp: 5, maxExp: 9 } })).json()) as { session: { id: string; label: string } };
    assert.match(s.session.label, /Go Kubernetes/);
    await api("/score-batch", key, { jobId, searchSessionId: s.session.id, candidates: [{ domId: "a", rawText: santhosh }, { domId: "c", rawText: pooja }] });
    const list = (await (await api(`/analyzed?jobId=${jobId}&searchSessionId=${s.session.id}`, key)).json()) as { items: { displayName: string; score: number }[] };
    assert.deepEqual(list.items.map((i) => i.displayName).sort(), ["Pooja Jaiswar", "Santhosh Kumar"]);
    const job = (await (await api(`/analyzed?jobId=${jobId}`, key)).json()) as { items: unknown[] };
    assert.ok(job.items.length >= 3);
  });

  it("deep-audits a profile", async () => {
    const profile = `${santhosh}\nEmail: santhosh@example.com Mobile: +91 98765 43210\nBuilt Kubernetes platform on AWS, cut deploy time 40% using Terraform and Go. Notice period: 30 days.`.padEnd(260, " .");
    const res = await api("/score-profile", key, { jobId, rawText: profile, profileUrl: "https://resdex.naukri.com/v3/profile?id=1" });
    const { audit } = (await res.json()) as { audit: { score: number; extracted: { fullName: string; phone: string; email: string; noticeDays: number }; strengths: string[] } };
    assert.equal(res.status, 200);
    assert.equal(audit.extracted.fullName, "Santhosh Kumar");
    assert.equal(audit.extracted.phone, "+919876543210");
    assert.equal(audit.extracted.noticeDays, 30);
    assert.ok(audit.score > 50);
  });

  it("saves a card, then the full profile of the same person, then a CV file: one candidate", async () => {
    const co = `Aptly Tech ${Date.now()}`; // unique per run so the test can be repeated on the same database
    const r = ((await (await api("/score-batch", key, { jobId, candidates: [{ domId: "a", rawText: santhosh }] })).json()) as { results: { score: number; matchedSkills: string[]; missingSkills: string[]; oneLineVerdict: string }[] }).results[0]!;
    const cardSave = await api("/import-candidate", key, { jobId, card: { fullName: "Santhosh Kumar", currentRole: "DevOps Engineer", currentCompany: co, totalExp: 7, currentCtc: 12, expectedCtc: null, noticePeriod: "", location: "Hyderabad", aiScore: r.score, matchedSkills: r.matchedSkills, missingSkills: r.missingSkills, verdict: r.oneLineVerdict } });
    const first = (await cardSave.json()) as { duplicate: boolean; candidate: { id: string }; webUrl: string };
    assert.equal(cardSave.status, 201);
    assert.equal(first.duplicate, false);

    const profileSave = await api("/import-candidate", key, { jobId, profileUrl: "https://resdex.naukri.com/v3/profile?id=1", rawText: `${santhosh}\nMobile +91 98765 43210`.padEnd(120, " ."), audit: { extracted: { fullName: "Santhosh Kumar", currentRole: "DevOps Engineer", currentCompany: co, totalExpYears: 7, currentCtcLpa: 12, noticePeriod: "30 days", location: "Hyderabad", email: "", phone: "" }, score: 84, matchedSkills: ["Kubernetes"], missingSkills: [], verdict: "Deep audit" } });
    const second = (await profileSave.json()) as { duplicate: boolean; candidate: { id: string }; contact: { phone: string | null } };
    assert.equal(second.candidate.id, first.candidate.id, "card and profile are the same candidate");
    assert.equal(second.duplicate, true);
    assert.equal(second.contact.phone, "+919876543210");

    const again = (await (await api("/import-candidate", key, { jobId, card: { fullName: "Santhosh Kumar", currentRole: "DevOps Engineer", currentCompany: co, totalExp: 7, aiScore: 70, matchedSkills: [], missingSkills: [], verdict: "card" } })).json()) as { keptFullProfile: boolean };
    assert.equal(again.keptFullProfile, true, "a later card save must not overwrite the full profile");

    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF Contact 98765 43210");
    const fd = new FormData();
    fd.append("file", new File([pdf], "cv.pdf", { type: "application/pdf" }));
    const up = await fetch(`${BASE}/api/extension/candidates/${first.candidate.id}/resume`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd });
    assert.equal(up.status, 200);
    const bad = new FormData();
    bad.append("file", new File([Buffer.from("<html>login</html>")], "cv.pdf"));
    assert.equal((await fetch(`${BASE}/api/extension/candidates/${first.candidate.id}/resume`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: bad })).status, 400);
  });

  it("keeps recruiters apart: a second login cannot see the first one's analyzed list", async () => {
    const res = await api("/login", undefined, { email: process.env.TG_EMAIL2, password: process.env.TG_PASSWORD2 });
    if (res.status !== 200) return;
    const key2 = ((await res.json()) as { apiKey: string }).apiKey;
    const list = (await (await api(`/analyzed?jobId=${jobId}`, key2)).json()) as { items: unknown[] };
    assert.equal(list.items.length, 0);
  });
});
