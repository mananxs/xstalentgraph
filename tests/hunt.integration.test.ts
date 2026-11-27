// Server-side end-to-end test of the XS-Hunt <-> extension workflow. The "extension" here is a scripted client that speaks the same HTTP
// protocol as the real one (heartbeat / commands / capture): it proves the PLATFORM side. It is NOT a test against real Naukri.
//   TG_URL=http://localhost:3107 npm run test:hunt
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const BASE = process.env.TG_URL ?? "";
const skip = !BASE;
type J = Record<string, any>;

async function web(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(res.status, 200, `login ${email}`);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const fn = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}), Cookie: cookie, ...(init.headers ?? {}) }, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
    const text = await r.text();
    let body: J = {};
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: r.status, body, headers: r.headers };
  };
  return Object.assign(fn, { cookie });
}
async function ext(email: string, password: string) {
  const login = (await (await fetch(`${BASE}/api/extension/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json()) as J;
  const call = async (path: string, json?: unknown) => {
    const r = await fetch(`${BASE}/api/extension${path}`, { method: json === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.apiKey}` }, body: json === undefined ? undefined : JSON.stringify(json) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as J };
  };
  return { key: login.apiKey as string, call };
}

const card = (name: string, years: string, ctc: string, city: string, role: string, skills: string, extra = "") => `${name}\n${years}\n${ctc}\n${city}\nCurrent\n${role}\nKey skills\n${skills}${extra}`;
const SANTHOSH = card("Santhosh Kumar", "7y 0m", "₹ 12 Lacs", "Hyderabad", "DevOps Engineer at Aptly Tech", "Kubernetes | Terraform | AWS | Go | Linux", "\nEducation\nB.Tech Computer Science\nNotice period: 30 days");
const VIBHUTI = card("Vibhuti Goel", "10y 0m", "₹ 0", "Noida", "Technical Solution Manager at Coralogix", "Observability | Sales | Presentation");
const POOJA = card("Pooja Jaiswar", "6y 2m", "₹ 18 Lacs", "Hyderabad", "Consulting Engineer at Capgemini", "Go | Kubernetes | AWS");
const POOJA2 = card("Pooja Jaiswar", "6y 0m", "₹ 20 Lacs", "Pune", "Cloud Engineer at Ola", "Go | AWS");

describe("XS-Hunt: platform <-> extension workflow", { skip }, () => {
  let hr: Awaited<ReturnType<typeof web>>, hr2: Awaited<ReturnType<typeof web>>, outsider: Awaited<ReturnType<typeof web>>;
  let agent: Awaited<ReturnType<typeof ext>>;
  let jobId = "", taskId = "";
  let matches: J[] = [];
  const HB = (state = "signed_in") => agent.call("/agent/heartbeat", { deviceId: "device-test-0001", version: "2.0.0", naukri: { state } });

  it("logs in three users of two organizations", async () => {
    hr = await web("hr@xs.com", "correct-horse-1");
    hr2 = await web("hr2@xs.com", "correct-horse-2");
    outsider = await web("out@other.com", "correct-horse-3");
    agent = await ext("hr@xs.com", "correct-horse-1");
  });

  it("creates a job and shows an honest 'never connected' extension state", async () => {
    const job = await hr("/api/jobs", { method: "POST", json: { title: "Senior SRE", description: "Own reliability. Up to 30 LPA. Notice period 30 days. B.Tech required.", requiredSkills: ["Kubernetes", "Go", "AWS"], preferredSkills: ["Terraform"], languages: ["Go"], locations: ["Hyderabad"], remoteAllowed: false, technologies: [], handsOn: [], experienceYears: 5, seniority: null, workMode: null, employmentType: null } });
    assert.equal(job.status, 201, JSON.stringify(job.body));
    jobId = job.body.job.id;
    const conn = await hr("/api/hunt/connection");
    assert.equal(conn.body.state, "never");
    assert.equal(conn.body.connected, false);
  });

  it("creates a sourcing task whose filters come from the job, separate from the evaluation rubric", async () => {
    const r = await hr(`/api/jobs/${jobId}/hunt/tasks`, { method: "POST", json: {} });
    assert.equal(r.status, 201);
    taskId = r.body.task.id;
    assert.ok(r.body.task.filters.boolean.length > 0);
    assert.deepEqual(r.body.task.filters.location, ["Hyderabad"]);
    assert.equal(r.body.task.sourcingState, "idle");
    assert.equal(r.body.task.aiState, "idle");
    const rubric = await hr(`/api/jobs/${jobId}/rubric`);
    assert.equal(rubric.body.version, 1);
    assert.equal(rubric.body.rubric.dimensions.length, 7);
  });

  it("refuses to send commands while no extension is connected (no fake success)", async () => {
    const r = await hr(`/api/hunt/tasks/${taskId}/commands`, { method: "POST", json: { type: "apply_filters" } });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /extension/i);
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/sourcing`, { method: "POST", json: { action: "start" } })).status, 409);
  });

  it("detects the connection and the Naukri session from the heartbeat", async () => {
    assert.equal((await HB("signed_out")).status, 200);
    let conn = await hr("/api/hunt/connection");
    assert.equal(conn.body.state, "connected");
    assert.equal(conn.body.naukri, "signed_out");
    const blocked = await hr(`/api/hunt/tasks/${taskId}/commands`, { method: "POST", json: { type: "apply_filters" } });
    assert.equal(blocked.status, 409, "signed-out Naukri must block applying filters");
    assert.match(blocked.body.error, /Naukri is not ready/);
    await HB("signed_in");
    conn = await hr("/api/hunt/connection");
    assert.equal(conn.body.naukri, "signed_in");
  });

  it("apply_filters: delivered once, acknowledged, and the task only shows what the extension READ BACK", async () => {
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/commands`, { method: "POST", json: { type: "apply_filters" } })).status, 202);
    const hb = await HB();
    const cmd = hb.body.commands.find((c: J) => c.type === "apply_filters");
    assert.ok(cmd, "command delivered");
    assert.ok(cmd.payload.job && cmd.payload.filters && cmd.payload.rubricVersion, "job, filters and rubric version travel with the command");
    let task = (await hr(`/api/hunt/tasks/${taskId}`)).body.task;
    assert.equal(task.filtersAppliedAt, null, "nothing is shown as applied before the extension reports");
    assert.deepEqual(task.filterReport, {});
    assert.equal((await agent.call(`/agent/commands/${cmd.id}/ack`, {})).status, 200);
    assert.equal((await agent.call(`/agent/commands/${cmd.id}/ack`, {})).status, 200, "ack is idempotent");
    assert.equal((await agent.call(`/agent/commands/${cmd.id}/result`, { status: "done", fields: { boolean: { status: "applied" }, location: { status: "applied" }, minExp: { status: "failed", detail: "field not found" }, notice: { status: "attention", detail: "pick an option" }, industry: { status: "unsupported", detail: "not mapped" } } })).status, 200);
    assert.equal((await agent.call(`/agent/commands/${cmd.id}/result`, { status: "done", fields: {} })).body.duplicate, true, "a repeated result is ignored");
    task = (await hr(`/api/hunt/tasks/${taskId}`)).body.task;
    assert.ok(task.filtersAppliedAt);
    assert.equal(task.filterReport.minExp.status, "failed");
    assert.equal(task.filterReport.industry.status, "unsupported");
    assert.ok(!(await HB()).body.commands.some((c: J) => c.id === cmd.id), "finished commands are not redelivered");
  });

  it("an acknowledged command that never finished is offered again after the stale window (browser restart recovery)", async () => {
    const q = await hr(`/api/hunt/tasks/${taskId}/commands`, { method: "POST", json: { type: "check_session" } });
    const cmd = (await HB()).body.commands.find((c: J) => c.id === q.body.command.id);
    await agent.call(`/agent/commands/${cmd.id}/ack`, {});
    assert.ok(!(await HB()).body.commands.some((c: J) => c.id === cmd.id), "a fresh ack is not redelivered");
    const { execSync } = await import("node:child_process");
    execSync(`psql "${process.env.DATABASE_URL}" -qc "update sourcing_commands set \\"ackedAt\\" = now() - interval '10 minutes' where id = '${cmd.id}'"`);
    assert.ok((await HB()).body.commands.some((c: J) => c.id === cmd.id && c.messageId === cmd.messageId), "same messageId comes back");
    await agent.call(`/agent/commands/${cmd.id}/result`, { status: "done", session: "signed_in" });
  });

  it("start sourcing; the extension captures pages; duplicates and re-delivery create nothing twice", async () => {
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/sourcing`, { method: "POST", json: { action: "start" } })).status, 200);
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/sourcing`, { method: "POST", json: { action: "start" } })).status, 409);
    const page1 = { taskId, page: 1, cards: [{ position: 0, rawText: SANTHOSH }, { position: 1, rawText: VIBHUTI }, { position: 2, rawText: POOJA }] };
    const c1 = await agent.call("/agent/capture", page1);
    assert.equal(c1.status, 200, JSON.stringify(c1.body));
    assert.equal(c1.body.captured, 3);
    assert.equal((await agent.call("/agent/capture", page1)).body.captured, 0, "re-delivery is idempotent");
    const c2 = await agent.call("/agent/capture", { taskId, page: 2, cards: [{ position: 0, rawText: POOJA2 }] });
    assert.equal(c2.body.captured, 1);
    assert.equal(c2.body.duplicates, 0, "name alone never merges people");
    const task = (await hr(`/api/hunt/tasks/${taskId}`)).body.task;
    assert.equal(task.counters.captured, 4);
    assert.equal(task.counters.pagesDone, 2);
    const list = await hr(`/api/jobs/${jobId}/candidates`);
    assert.equal(list.body.total, 4);
    assert.ok(list.body.rows.every((r: J) => r.primarySource === "naukri" && r.sources.includes("naukri") && r.score === null), "captured, not yet analysed");
  });

  it("sourcing and AI analysis are independent: pausing one never changes the other", async () => {
    const idle = await hr(`/api/hunt/tasks/${taskId}/ai/run`, { method: "POST", json: {} });
    assert.equal(idle.body.processed, 0);
    assert.equal(idle.body.remaining, 4);
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/ai`, { method: "POST", json: { action: "start" } })).body.state, "running");
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/sourcing`, { method: "POST", json: { action: "pause" } })).body.state, "paused");
    let task = (await hr(`/api/hunt/tasks/${taskId}`)).body.task;
    assert.equal(task.sourcingState, "paused");
    assert.equal(task.aiState, "running", "pausing sourcing does not stop AI");
    const batch = await hr(`/api/hunt/tasks/${taskId}/ai/run`, { method: "POST", json: { limit: 2 } });
    assert.equal(batch.body.processed, 2);
    assert.equal(batch.body.remaining, 2);
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/ai`, { method: "POST", json: { action: "pause" } })).body.state, "paused");
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/ai/run`, { method: "POST", json: {} })).body.processed, 0, "paused AI does nothing");
    task = (await hr(`/api/hunt/tasks/${taskId}`)).body.task;
    assert.equal(task.sourcingState, "paused");
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/sourcing`, { method: "POST", json: { action: "resume" } })).body.state, "running");
    assert.equal((await hr(`/api/hunt/tasks/${taskId}/ai`, { method: "POST", json: { action: "resume" } })).body.state, "running");
    const rest = await hr(`/api/hunt/tasks/${taskId}/ai/run`, { method: "POST", json: { limit: 20 } });
    assert.equal(rest.body.remaining, 0);
    assert.equal(rest.body.state, "completed");
    task = (await hr(`/api/hunt/tasks/${taskId}`)).body.task;
    assert.equal(task.counters.analyzed, 4);
  });

  it("evaluates with the seven-dimension rubric: tiers, missing information vs mismatch, per-criterion evidence", async () => {
    matches = (await hr(`/api/jobs/${jobId}/candidates`)).body.rows;
    const by = Object.fromEntries(matches.map((r: J) => [r.name + "|" + r.headline, r]));
    const santhosh = by["Santhosh Kumar|DevOps Engineer at Aptly Tech"]!;
    const vibhuti = by["Vibhuti Goel|Technical Solution Manager at Coralogix"]!;
    assert.ok(santhosh.score > vibhuti.score, `${santhosh.score} vs ${vibhuti.score}`);
    assert.ok(["strong", "potential", "provisional"].includes(santhosh.tier), santhosh.tier);
    assert.equal(santhosh.rubricVersion, 1);
    const dims = (await hr(`/api/matches/${santhosh.matchId}`)).body.evaluation.dimensions;
    for (const k of ["skills", "experience", "compensation", "availability", "location", "education", "career"]) assert.ok(dims[k], `dimension ${k}`);
    assert.equal(dims.availability.status, "confirmed", "30 days notice is stated on the card");
    const vib = await hr(`/api/matches/${vibhuti.matchId}`);
    assert.equal(vib.body.evaluation.dimensions.availability.status, "missing", "an absent notice period is missing information, not a mismatch");
    assert.ok(vib.body.evaluation.missingInfo.length > 0);
  });

  it("deduplicates through reliable identifiers only", async () => {
    const before = (await hr(`/api/jobs/${jobId}/candidates`)).body.total;
    const saved = await agent.call("/import-candidate", { jobId, profileUrl: "https://resdex.naukri.com/v3/profile?id=777", rawText: SANTHOSH + "\nEmail: santhosh@example.com Mobile: +91 98765 43210\n" + "Built Kubernetes platform on AWS, cut deploy time 40%.".padEnd(120, " ."), audit: { extracted: { fullName: "Santhosh Kumar", currentRole: "DevOps Engineer", currentCompany: "Aptly Tech", totalExpYears: 7, currentCtcLpa: 12, noticePeriod: "30 days", location: "Hyderabad", email: "", phone: "" }, score: 80, matchedSkills: ["Kubernetes"], missingSkills: [], verdict: "v" } });
    assert.ok([200, 201].includes(saved.status), JSON.stringify(saved.body));
    assert.equal((await hr(`/api/jobs/${jobId}/candidates`)).body.total, before, "same person: no new row");
    const found = (await hr(`/api/talent-pool?q=Santhosh`)).body.candidates;
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].sources, ["naukri"]);
  });

  it("stages: eleven stages, rejection needs a reason, every move is audited", async () => {
    matches = (await hr(`/api/jobs/${jobId}/candidates`)).body.rows;
    const m = matches.find((r) => r.name === "Santhosh Kumar")!;
    assert.equal((await hr(`/api/matches/${m.matchId}`, { method: "PATCH", json: { action: "stage", to: "bogus" } })).status, 400);
    assert.equal((await hr(`/api/matches/${m.matchId}`, { method: "PATCH", json: { action: "stage", to: "rejected" } })).status, 400, "rejection without reason");
    for (const to of ["screening", "shortlisted", "contacted", "interview_scheduled", "interviewed", "assessment", "offer", "hired"]) {
      const r = await hr(`/api/matches/${m.matchId}`, { method: "PATCH", json: { action: "stage", to } });
      assert.equal(r.status, 200, `${to}: ${JSON.stringify(r.body)}`);
    }
    const v = matches.find((r) => r.name === "Vibhuti Goel")!;
    assert.equal((await hr(`/api/matches/${v.matchId}`, { method: "PATCH", json: { action: "stage", to: "rejected", reason: "Sales profile, not engineering" } })).status, 200);
    const detail = await hr(`/api/matches/${m.matchId}`);
    assert.ok(detail.body.events.filter((e: J) => e.kind === "stage").length >= 8);
    assert.equal(detail.body.match.stage, "hired");
    assert.equal((await hr(`/api/matches/${v.matchId}`)).body.match.rejectionReason, "Sales profile, not engineering");
  });

  it("notes, interview, reminder and recruiter override keep the AI result and record a reason", async () => {
    const p = matches.find((r) => r.name === "Pooja Jaiswar" && /Capgemini/.test(r.headline))!;
    assert.equal((await hr(`/api/matches/${p.matchId}`, { method: "PATCH", json: { action: "note", body: "Spoke to her; keen on the role." } })).status, 201);
    assert.equal((await hr(`/api/matches/${p.matchId}`, { method: "PATCH", json: { action: "reminder", dueAt: new Date(Date.now() + 86400000).toISOString(), text: "Call back" } })).status, 201);
    assert.equal((await hr(`/api/matches/${p.matchId}`, { method: "PATCH", json: { action: "interview", scheduledAt: new Date(Date.now() + 172800000).toISOString(), mode: "video" } })).status, 201);
    assert.equal((await hr(`/api/matches/${p.matchId}`, { method: "PATCH", json: { action: "override", score: 95 } })).status, 400, "override needs a reason");
    assert.equal((await hr(`/api/matches/${p.matchId}`, { method: "PATCH", json: { action: "override", score: 95, tier: "strong", reason: "Referred by the CTO" } })).status, 200);
    const row = (await hr(`/api/jobs/${jobId}/candidates`)).body.rows.find((r: J) => r.matchId === p.matchId);
    assert.equal(row.score, 95);
    assert.equal(row.aiScore, p.aiScore, "the AI score is preserved");
    assert.equal(row.overridden, true);
    const d = await hr(`/api/matches/${p.matchId}`);
    assert.equal(d.body.match.stage, "interview_scheduled");
    assert.equal(d.body.notes.length, 1);
    assert.ok(d.body.events.some((e: J) => e.kind === "override" && e.data.reason === "Referred by the CTO"));
  });

  it("rubric changes create a new version; optional rescoring records which version produced each evaluation", async () => {
    const cur = (await hr(`/api/jobs/${jobId}/rubric`)).body;
    const rubric = JSON.parse(JSON.stringify(cur.rubric));
    rubric.dimensions.find((d: J) => d.key === "compensation").config.maxLpa = 10;
    rubric.dimensions.find((d: J) => d.key === "skills").weight = 60;
    rubric.custom = [{ name: "On-call", weight: 10, keywords: ["on-call", "pager"] }];
    const noRescore = await hr(`/api/jobs/${jobId}/rubric`, { method: "PUT", json: { rubric, notes: "Budget set", rescore: false } });
    assert.equal(noRescore.body.version, 2);
    assert.equal(noRescore.body.rescored, null);
    assert.equal((await hr(`/api/jobs/${jobId}/candidates`)).body.rows.find((r: J) => r.name === "Santhosh Kumar").rubricVersion, 1, "without rescoring, scores stay under the version that made them");
    const rescored = await hr(`/api/jobs/${jobId}/rubric`, { method: "PUT", json: { rubric, rescore: true } });
    assert.equal(rescored.body.version, 3);
    assert.ok(rescored.body.rescored >= 4);
    const now = (await hr(`/api/jobs/${jobId}/candidates`)).body.rows.find((r: J) => r.name === "Santhosh Kumar");
    assert.equal(now.rubricVersion, 3);
    const d = await hr(`/api/matches/${now.matchId}`);
    assert.ok(d.body.history.some((h: J) => h.rubricVersion === 1) && d.body.history.some((h: J) => h.rubricVersion === 3));
    assert.equal(d.body.evaluation.dimensions.compensation.status, "confirmed");
    assert.ok(d.body.evaluation.dimensions.custom_0);
  });

  it("compares 2 to 5 candidates and reports missing data honestly", async () => {
    const ids = matches.slice(0, 3).map((r) => r.matchId).join(",");
    const ok = await hr(`/api/jobs/${jobId}/compare?ids=${ids}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.candidates.length, 3);
    assert.equal((await hr(`/api/jobs/${jobId}/compare?ids=${matches[0]!.matchId}`)).status, 400);
    assert.ok(ok.body.candidates.every((c: J) => c.certifications === null || Array.isArray(c.certifications)));
  });

  it("retrieval needs explicit approval, and unusable candidates are reported as unavailable", async () => {
    const santhosh = matches.find((r) => r.name === "Santhosh Kumar")!;
    const noAck = await hr("/api/hunt/retrievals", { method: "POST", json: { jobId, candidateIds: [santhosh.candidateId] } });
    assert.equal(noAck.status, 400);
    assert.match(noAck.body.error, /credit/i);
    const none = await hr("/api/hunt/retrievals", { method: "POST", json: { jobId, candidateIds: [matches.find((r) => r.name === "Vibhuti Goel")!.candidateId], creditAck: true } });
    assert.equal(none.status, 202);
    assert.equal(none.body.queued, 0);
    assert.equal(none.body.unavailable.length, 1);
    const withLink = await agent.call("/agent/capture", { taskId, page: 3, cards: [{ position: 0, rawText: card("Lakshmi Rao", "8y 0m", "₹ 22 Lacs", "Hyderabad", "SRE at Zoho", "Kubernetes | Go | AWS"), profileUrl: "https://resdex.naukri.com/v3/candidate/profile?candidateId=lr88" }] });
    assert.equal(withLink.body.captured, 1);
    const lakshmi = (await hr(`/api/jobs/${jobId}/candidates?q=Lakshmi`)).body.rows[0];
    const queued = await hr("/api/hunt/retrievals", { method: "POST", json: { jobId, candidateIds: [lakshmi.candidateId], creditAck: true } });
    assert.equal(queued.body.queued, 1);
    const cmd = (await HB()).body.commands.find((c: J) => c.type === "retrieve_profiles");
    assert.ok(cmd && cmd.payload.creditAck === true && cmd.payload.requests[0].profileUrl.includes("candidateId=lr88"));
    await agent.call(`/agent/commands/${cmd.id}/ack`, {});
    await agent.call(`/agent/commands/${cmd.id}/result`, { status: "done", items: [{ requestId: cmd.payload.requests[0].id, status: "unavailable", reason: "Naukri asked for a credit the account does not have" }] });
    const status = (await hr(`/api/hunt/retrievals?jobId=${jobId}`)).body.requests.find((r: J) => r.candidateId === lakshmi.candidateId);
    assert.equal(status.status, "unavailable");
    assert.match(status.reason, /credit/);
  });

  it("stores an uploaded resume once, serves it to the organization only, and audits the view", async () => {
    const m = matches.find((r) => r.name === "Santhosh Kumar")!;
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF Santhosh Kumar Kubernetes AWS");
    const up = async () => {
      const fd = new FormData();
      fd.append("file", new File([pdf], "cv.pdf", { type: "application/pdf" }));
      return fetch(`${BASE}/api/extension/candidates/${m.candidateId}/resume`, { method: "POST", headers: { Authorization: `Bearer ${agent.key}` }, body: fd });
    };
    assert.equal((await up()).status, 200);
    assert.equal(((await (await up()).json()) as J).resume.duplicate, true, "the same file is not stored twice");
    const view = await fetch(`${BASE}/api/candidates/${m.candidateId}/resume`, { headers: { Cookie: hr.cookie } });
    assert.equal(view.status, 200);
    assert.equal(view.headers.get("content-type"), "application/pdf");
    assert.equal(view.headers.get("cache-control"), "private, no-store");
    assert.equal((await outsider(`/api/candidates/${m.candidateId}/resume`)).status, 404, "another organization cannot read it");
    assert.ok((await hr(`/api/matches/${m.matchId}`)).body.events.some((e: J) => e.kind === "resume_view"), "the view is in the audit log");
  });

  it("isolates organizations completely", async () => {
    const m = matches[0]!;
    assert.equal((await outsider(`/api/hunt/tasks/${taskId}`)).status, 404);
    assert.equal((await outsider(`/api/jobs/${jobId}/candidates`)).status, 404);
    assert.equal((await outsider(`/api/matches/${m.matchId}`)).status, 404);
    assert.equal((await outsider(`/api/matches/${m.matchId}`, { method: "PATCH", json: { action: "note", body: "x" } })).status, 404);
    assert.equal((await outsider(`/api/hunt/tasks/${taskId}/sourcing`, { method: "POST", json: { action: "stop" } })).status, 404);
    assert.equal((await outsider("/api/talent-pool")).body.total, 0);
    assert.equal((await outsider("/api/dashboard")).body.totalCandidates, 0);
    const other = await ext("out@other.com", "correct-horse-3");
    assert.equal((await other.call("/agent/capture", { taskId, page: 1, cards: [{ position: 0, rawText: SANTHOSH }] })).status, 404);
  });

  it("roles: a viewer can read but not change anything; admins manage the team", async () => {
    const add = await hr("/api/team", { method: "POST", json: { email: "viewer@xs.com", name: "View Er", password: "viewer-pass-1", role: "viewer" } });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    assert.equal((await hr2("/api/team", { method: "POST", json: { email: "x@xs.com", name: "X", password: "xxxxxxxx" } })).status, 403, "a recruiter cannot add members");
    const viewer = await web("viewer@xs.com", "viewer-pass-1");
    assert.equal((await viewer(`/api/jobs/${jobId}/candidates`)).status, 200);
    assert.equal((await viewer(`/api/matches/${matches[0]!.matchId}`, { method: "PATCH", json: { action: "note", body: "x" } })).status, 403);
    assert.equal((await viewer(`/api/hunt/tasks/${taskId}/sourcing`, { method: "POST", json: { action: "stop" } })).status, 403);
    const me = (await hr("/api/team")).body.members.find((m: J) => m.email === "hr@xs.com");
    assert.equal((await hr("/api/team", { method: "PATCH", json: { memberId: me.id, role: "recruiter" } })).status, 409, "the last admin cannot be demoted");
  });

  it("dashboard and analytics are counted from the database", async () => {
    const dash = (await hr("/api/dashboard")).body;
    assert.equal(dash.totalCandidates, 5);
    assert.ok(dash.shortlisted >= 1);
    for (const k of ["totalCandidates", "shortlisted", "pendingReview", "strongMatches"]) assert.equal(typeof dash[k], "number");
    const a = (await hr(`/api/analytics?jobId=${jobId}`)).body;
    assert.equal(a.totalSourced, 5);
    assert.equal(a.byPlatform.naukri, 5);
    assert.equal(a.stageCounts.hired, 1);
    assert.equal(a.stageCounts.rejected, 1);
    assert.ok(a.funnel.find((f: J) => f.stage === "hired").count >= 1);
    assert.ok(a.conversion[0].hired >= 1);
    assert.equal(typeof a.avgDaysInStage.screening, "number");
    assert.equal((await hr(`/api/analytics?jobId=${jobId}&source=linkedin`)).body.totalSourced, 0, "no invented numbers for a source with no candidates");
    assert.equal((await hr(`/api/analytics?from=2099-01-01`)).body.totalSourced, 0);
  });

  it("limits stop capture; stop ends the run", async () => {
    const t = await hr(`/api/jobs/${jobId}/hunt/tasks`, { method: "POST", json: { limits: { maxPages: 2, maxCandidates: 1, delaySeconds: 3 } } });
    const id = t.body.task.id;
    const cap = await agent.call("/agent/capture", { taskId: id, page: 1, cards: [{ position: 0, rawText: card("Ravi Teja", "5y 0m", "₹ 10 Lacs", "Hyderabad", "SRE at Zoho", "Go | AWS") }, { position: 1, rawText: card("Meena Das", "6y 0m", "₹ 11 Lacs", "Hyderabad", "SRE at Zoho", "Go | AWS") }] });
    assert.equal(cap.body.captured, 1);
    assert.equal(cap.body.limitReached, true);
    assert.equal((await hr(`/api/hunt/tasks/${id}/sourcing`, { method: "POST", json: { action: "start", skipFilters: true } })).status, 200);
    assert.equal((await hr(`/api/hunt/tasks/${id}/sourcing`, { method: "POST", json: { action: "stop" } })).body.state, "stopped");
  });
});
