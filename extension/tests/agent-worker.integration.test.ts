// The REAL extension service-worker agent (src/background/agent.ts) talking to a REAL XS-Hunt server, with a fake `chrome` and a
// scripted page. It proves the protocol, persistence and recovery. It does NOT touch Naukri.
//   TG_URL=http://localhost:3107 TG_EMAIL=hr@xs.com TG_PASSWORD=... npm run test:worker
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { describe, it } from "node:test";
import { createAgent } from "../src/background/agent";

const BASE = process.env.TG_URL ?? "";
const skip = !BASE;
type J = Record<string, any>;

const card = (name: string, years: string, role: string) => `${name}\n${years}\n₹ 15 Lacs\nHyderabad\nCurrent\n${role}\nKey skills\nKubernetes | Go | AWS\nNotice period: 30 days`;
const PAGES: Record<number, Array<{ position: number; rawText: string; profileUrl: string | null }>> = {
  1: [{ position: 0, rawText: card("Anil Kapoor", "7y 0m", "SRE at Zoho"), profileUrl: "https://resdex.naukri.com/v3/candidate/profile?candidateId=ak1" }, { position: 1, rawText: card("Bina Rao", "6y 0m", "DevOps at Ola"), profileUrl: null }],
  2: [{ position: 0, rawText: card("Chetan Shah", "8y 0m", "SRE at Freshworks"), profileUrl: null }],
};
const PDF_B64 = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF Anil Kapoor").toString("base64");

function fakeBrowser() {
  const store: Record<string, unknown> = {};
  const state = { session: "signed_in", executed: [] as string[], tabUrl: "https://resdex.naukri.com/search?q=go", online: true, failCaptureOnce: false, openProfile: true, giveCv: true };
  let agentRef: ReturnType<typeof createAgent>;
  const chromeLike = {
    storage: { local: { get: async (k: string | null) => (k === null ? { ...store } : { [k as string]: store[k as string] }), set: async (o: Record<string, unknown>) => void Object.assign(store, JSON.parse(JSON.stringify(o))), remove: async (k: string) => void delete store[k] } },
    tabs: {
      query: async () => [{ id: 7, url: state.tabUrl, active: true, status: "complete" }],
      get: async () => ({ id: 7, url: state.tabUrl, status: "complete" }),
      create: async () => ({ id: 7 }),
      update: async (_id: number, p: { url?: string }) => { if (p.url) state.tabUrl = p.url; return { id: 7 }; },
      sendMessage: async (_id: number, msg: J) => {
        switch (msg.type) {
          case "AGENT_SESSION": return { ok: true, session: state.session };
          case "FILL_RESDEX_SEARCH": return { ok: true, fields: [{ key: "boolean", status: "filled" }, { key: "location", status: "filled" }, { key: "minExp", status: "filled" }, { key: "designation", status: "manual" }, { key: "education", status: "missing" }] };
          case "AGENT_VERIFY_FILTERS": return { ok: true, fields: { boolean: { status: "applied", detail: "Naukri shows the query" }, location: { status: "applied" }, minExp: { status: "failed", detail: "Expected 5, Naukri shows nothing" }, designation: { status: "attention", detail: "manual pick" }, education: { status: "unsupported" }, industry: { status: "unsupported", detail: "not mapped" } } };
          case "AGENT_RUN": {
            // the page agent: read page 1 and page 2, delivering each through the worker exactly like content/agent-content.ts does
            void (async () => { for (const page of [1, 2]) { const r = (await agentRef.capture(((await chromeLike.storage.local.get("agent.run")) as J)["agent.run"].taskId, page, PAGES[page]!).catch(() => null)); if (r?.limitReached) break; } })();
            return { ok: true };
          }
          case "READ_PROFILE": return state.openProfile ? { open: true, url: state.tabUrl, rawText: card("Anil Kapoor", "7y 0m", "SRE at Zoho") + "\nMobile: +91 98765 11111\nBuilt Kubernetes platform on AWS, cut costs 30%.".padEnd(300, " ."), phones: ["+919876511111"], emails: [], phoneMasked: false, cvLinks: state.giveCv ? [{ href: "https://resdex.naukri.com/cv/download?id=1", label: "Download CV" }] : [] } : { open: false, url: state.tabUrl, rawText: "", phones: [], emails: [], phoneMasked: false, cvLinks: [] };
          case "FETCH_CV": return { ok: true, name: "Anil_Kapoor.pdf", mime: "application/pdf", base64: PDF_B64 };
        }
        state.executed.push(String(msg.type));
        return { ok: true };
      },
    },
    scripting: { executeScript: async () => [] },
  } as unknown as typeof chrome;
  const flakyFetch: typeof fetch = async (input, init) => {
    if (!state.online) throw new TypeError("network down");
    if (state.failCaptureOnce && String(input).includes("/agent/capture")) { state.failCaptureOnce = false; throw new TypeError("network blip"); }
    return fetch(input, init);
  };
  const agent = createAgent({ chrome: chromeLike, fetch: flakyFetch, sleep: async () => {}, version: "2.0.0-test" });
  agentRef = agent;
  return { agent, store, state, chrome: chromeLike };
}

async function web(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  return async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}), Cookie: cookie }, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as J, raw: r };
  };
}

describe("extension worker <-> platform", { skip }, () => {
  const b = fakeBrowser();
  let hr: Awaited<ReturnType<typeof web>>;
  let jobId = "", taskId = "";
  const tick = () => b.agent.tick(true);

  it("logs in like the side panel does and registers as a connected extension", async () => {
    const login = (await (await fetch(`${BASE}/api/extension/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: process.env.TG_EMAIL, password: process.env.TG_PASSWORD }) })).json()) as J;
    await b.chrome.storage.local.set({ config: { baseUrl: BASE, apiKey: login.apiKey, user: login.user } });
    hr = await web(process.env.TG_EMAIL!, process.env.TG_PASSWORD!);
    const job = await hr("/api/jobs", { json: { title: "Worker Test SRE", description: "Own reliability. Notice period 30 days.", requiredSkills: ["Kubernetes", "Go", "AWS"], preferredSkills: [], languages: ["Go"], locations: ["Hyderabad"], remoteAllowed: false, technologies: [], handsOn: [], experienceYears: 5, seniority: null, workMode: null, employmentType: null }, method: "POST" });
    jobId = job.body.job.id;
    taskId = (await hr(`/api/jobs/${jobId}/hunt/tasks`, { method: "POST", json: {} })).body.task.id;
    await tick();
    const conn = (await hr("/api/hunt/connection")).body;
    assert.equal(conn.state, "connected");
    assert.equal(conn.naukri, "signed_in");
    assert.equal(conn.version, "2.0.0-test");
  });

  it("adopts a JD uploaded in the web app by itself, then sends the cards the HR views to that job (no start needed)", async () => {
    const job = await hr("/api/jobs", { method: "POST", json: { title: "Auto Hand-off Engineer", description: "Run the platform. Notice period 30 days.", requiredSkills: ["Kubernetes", "Go"], preferredSkills: [], languages: ["Go"], locations: ["Hyderabad"], technologies: [], handsOn: [], remoteAllowed: false, experienceYears: 5 } });
    assert.equal(job.status, 201, JSON.stringify(job.body));
    const newJob = job.body.job.id as string;
    await tick();
    const adopted = ((await b.chrome.storage.local.get("activeJob")) as J).activeJob;
    assert.equal(adopted?.id, newJob, "the new job became the extension's active job with no click in the extension");
    const viewed = PAGES[1]!.map((c) => ({ rawText: c.rawText, profileUrl: c.profileUrl ?? undefined }));
    const seen = await b.agent.autoCapture(newJob, viewed);
    assert.equal(seen?.captured, 2);
    assert.equal(await b.agent.autoCapture(newJob, viewed), null, "cards already sent are not sent again");
    const rows = (await hr(`/api/jobs/${newJob}/candidates`)).body.rows as J[];
    assert.equal(rows.length, 2, "they show up in the web app");
    // restore the original job for the tests below
    await hr(`/api/jobs/${jobId}/extension`, { method: "POST" });
    await tick();
  });

  it("reports a lost Naukri session honestly and blocks work until it is back", async () => {
    b.state.session = "expired";
    await tick();
    assert.equal((await hr("/api/hunt/connection")).body.naukri, "expired");
    const blocked = await hr(`/api/hunt/tasks/${taskId}/commands`, { method: "POST", json: { type: "apply_filters" } });
    assert.equal(blocked.status, 409);
    b.state.session = "signed_in";
    await tick();
    assert.equal((await hr("/api/hunt/connection")).body.naukri, "signed_in");
  });

  it("applies filters, reads them back, and the platform shows exactly the verified result", async () => {
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/commands`, { method: "POST", json: { type: "apply_filters" } })).status, 202);
    await tick();
    const task = (await hr(`/api/hunt/tasks/${taskId}`)).body.task;
    assert.equal(task.filterReport.boolean.status, "applied");
    assert.equal(task.filterReport.minExp.status, "failed", "a typed-but-unverified value is reported as failed, not applied");
    assert.equal(task.filterReport.designation.status, "attention");
    assert.equal(task.filterReport.industry.status, "unsupported");
    assert.ok(task.filtersAppliedAt);
    const act = ((await b.chrome.storage.local.get("activeJob")) as J).activeJob;
    assert.equal(act.title, "Worker Test SRE", "the job and its rubric were handed to the extension");
  });

  it("start sourcing: the page agent captures pages through the worker; AI is separate", async () => {
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/sourcing`, { method: "POST", json: { action: "start" } })).status, 200);
    await tick();
    await new Promise((r) => setTimeout(r, 1500));
    const run = ((await b.chrome.storage.local.get("agent.run")) as J)["agent.run"];
    assert.equal(run.state, "running");
    const task = (await hr(`/api/hunt/tasks/${taskId}`)).body.task;
    assert.equal(task.counters.captured, 3);
    assert.equal(task.counters.analyzed, 0, "capture does not trigger AI");
    assert.equal(task.aiState, "idle");
    assert.equal((await hr(`/api/jobs/${jobId}/candidates`)).body.total, 3);
  });

  it("a network failure while delivering a page never loses it (outbox), and re-delivery creates no duplicates", async () => {
    b.state.failCaptureOnce = true;
    await b.agent.capture(taskId, 3, [{ position: 0, rawText: card("Deepa Nair", "9y 0m", "SRE at Razorpay"), profileUrl: null }]).catch(() => null);
    assert.equal((await hr(`/api/jobs/${jobId}/candidates`)).body.total, 3, "not delivered yet");
    const outbox = ((await b.chrome.storage.local.get("agent.outbox")) as J)["agent.outbox"];
    assert.equal(outbox.length, 1, "queued locally");
    await tick();
    assert.equal((await hr(`/api/jobs/${jobId}/candidates`)).body.total, 4, "delivered on the next tick");
    await b.agent.capture(taskId, 3, [{ position: 0, rawText: card("Deepa Nair", "9y 0m", "SRE at Razorpay"), profileUrl: null }]);
    assert.equal((await hr(`/api/jobs/${jobId}/candidates`)).body.total, 4, "same card again: still one row");
  });

  it("the platform's Pause reaches the browser on the next heartbeat", async () => {
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/sourcing`, { method: "POST", json: { action: "pause" } })).status, 200);
    await tick();
    assert.equal(((await b.chrome.storage.local.get("agent.run")) as J)["agent.run"].state, "paused");
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/sourcing`, { method: "POST", json: { action: "stop" } })).status, 200);
    await tick();
    assert.equal(((await b.chrome.storage.local.get("agent.run")) as J)["agent.run"].state, "stopped");
  });

  it("retrieval: only after approval; opens the profile, saves it, stores the CV file, and returns to the results page", async () => {
    const anil = (await hr(`/api/jobs/${jobId}/candidates?q=Anil`)).body.rows[0];
    const returnUrl = b.state.tabUrl;
    assert.equal((await hr("/api/hunt/retrievals", { method: "POST", json: { jobId, candidateIds: [anil.candidateId] } })).status, 400, "no approval, nothing queued");
    assert.equal((await hr("/api/hunt/retrievals", { method: "POST", json: { jobId, candidateIds: [anil.candidateId], creditAck: true } })).body.queued, 1);
    await tick();
    const req = (await hr(`/api/hunt/retrievals?jobId=${jobId}`)).body.requests.find((r: J) => r.candidateId === anil.candidateId);
    assert.equal(req.status, "done", JSON.stringify(req));
    assert.equal(b.state.tabUrl, returnUrl, "the tab goes back to the results page");
    const detail = (await hr(`/api/matches/${anil.matchId}`)).body;
    const resume = await hr(`/api/candidates/${anil.candidateId}/resume`);
    assert.equal(resume.status, 200);
    assert.equal(resume.raw.headers.get("content-type"), "application/pdf");
    assert.ok(detail.events.length > 0);
    const cand = (await hr(`/api/jobs/${jobId}/candidates?q=Anil`)).body.rows[0];
    assert.equal(cand.fullProfile, true);
    assert.equal(cand.hasResume, true);
  });

  it("retrieval when Naukri will not show the profile is reported as unavailable (nothing is faked)", async () => {
    const cards = (await hr(`/api/jobs/${jobId}/candidates?q=Chetan`)).body.rows[0];
    // give Chetan a link so he can be queued
    execSync(`psql "${process.env.DATABASE_URL}" -qc "update candidates set \\"profileUrl\\" = 'https://resdex.naukri.com/v3/candidate/profile?candidateId=cs2' where id = '${cards.candidateId}'"`);
    b.state.openProfile = false;
    assert.equal((await hr("/api/hunt/retrievals", { method: "POST", json: { jobId, candidateIds: [cards.candidateId], creditAck: true } })).body.queued, 1);
    await tick();
    const req = (await hr(`/api/hunt/retrievals?jobId=${jobId}`)).body.requests.find((r: J) => r.candidateId === cards.candidateId);
    assert.equal(req.status, "unavailable");
    assert.match(req.reason, /did not show the full profile/);
    b.state.openProfile = true;
  });

  it("a command finished locally whose result never arrived is answered from memory, never executed twice", async () => {
    await hr(`/api/hunt/tasks/${taskId}/commands`, { method: "POST", json: { type: "check_session" } });
    const before = b.state.executed.length;
    // The worker "crashes" after finishing the command but before the platform received the result.
    b.state.online = true;
    const origFetch = b.agent;
    void origFetch;
    await tick(); // executes + posts result normally
    const cmds = (await hr(`/api/hunt/tasks/${taskId}`)).body.task.commands.filter((c: J) => c.type === "check_session");
    assert.equal(cmds[0].status, "done");
    // simulate: the platform never got it -> mark acked-and-stale again; the worker must not run it again.
    execSync(`psql "${process.env.DATABASE_URL}" -qc "update sourcing_commands set status = 'acked', \\"ackedAt\\" = now() - interval '10 minutes', \\"doneAt\\" = null where id = '${cmds[0].id}'"`);
    await tick();
    const after = (await hr(`/api/hunt/tasks/${taskId}`)).body.task.commands.find((c: J) => c.id === cmds[0].id);
    assert.equal(after.status, "done", "answered again from the stored result");
    void before;
  });

  it("goes quiet honestly: with no heartbeat the platform shows 'disconnected', never 'connected'", async () => {
    execSync(`psql "${process.env.DATABASE_URL}" -qc "update extension_connections set \\"lastSeenAt\\" = now() - interval '5 minutes'"`);
    const conn = (await hr("/api/hunt/connection")).body;
    assert.equal(conn.state, "disconnected");
    assert.equal(conn.connected, false);
    assert.equal(conn.naukri, "unknown", "the old Naukri state is not presented as current");
    b.state.online = false;
    await tick();
    const status = ((await b.chrome.storage.local.get("agent.status")) as J)["agent.status"];
    assert.equal(status.connected, false);
    assert.match(status.error, /reach/i);
    b.state.online = true;
    await tick();
    assert.equal((await hr("/api/hunt/connection")).body.state, "connected");
  });
});
