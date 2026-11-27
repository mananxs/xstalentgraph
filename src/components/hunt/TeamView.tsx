"use client";

import { useCallback, useEffect, useState } from "react";
import { toMessage } from "@/lib/api";
import { hunt } from "@/lib/hunt";
import { Badge, Button, Card, inputClass, Notice, PageHeader, Skeleton } from "./ui";

type Team = Awaited<ReturnType<typeof hunt.team>>;
const ROLE_HELP: Record<string, string> = { admin: "Everything, plus managing the team.", recruiter: "Source, evaluate, move candidates, approve profile retrieval.", viewer: "Read-only: can look at jobs, candidates and reports." };

export function TeamView() {
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "recruiter" });
  const [busy, setBusy] = useState(false);
  const isAdmin = team?.me.role === "admin";
  const load = useCallback(() => hunt.team().then(setTeam).catch((e: unknown) => setError(toMessage(e))), []);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true); setError(null); setOk(null);
    try { await fn(); setOk(done); await load(); } catch (e) { setError(toMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Team & Permissions" subtitle="Who can sign in to your XS-Hunt workspace and what they can do." />
      {error && <Notice>{error}</Notice>}
      {ok && <Notice tone="green">{ok}</Notice>}
      {!team && !error && <Skeleton className="h-48" />}
      {team && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-600"><tr><th className="p-3">Member</th><th>Role</th><th>Extension keys</th><th /></tr></thead>
            <tbody>
              {team.members.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100">
                  <td className="p-3"><span className="font-medium text-zinc-950">{m.name}</span>{m.id === team.me.id && <Badge tone="indigo" className="ml-2">You</Badge>}<span className="block text-xs text-zinc-600">{m.email}{m.canSignIn ? "" : " (cannot sign in: no password set)"}</span></td>
                  <td>
                    <label><span className="sr-only">Role of {m.name}</span>
                      <select disabled={!isAdmin || busy} value={m.role} onChange={(e) => void run(() => hunt.updateMember({ memberId: m.id, role: e.target.value }), `${m.name} is now ${e.target.value}.`)} className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm disabled:opacity-60">
                        {["admin", "recruiter", "viewer"].map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </label>
                  </td>
                  <td className="tabular-nums text-zinc-600">{m.extensionKeys}</td>
                  <td className="pr-3 text-right">{isAdmin && <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => { const pw = window.prompt(`New password for ${m.name} (8+ characters)`); if (pw && pw.length >= 8) void run(() => hunt.updateMember({ memberId: m.id, password: pw }), `Password reset for ${m.name}.`); }}>Reset password</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-zinc-950">Roles</h2>
        <ul className="mt-2 space-y-1 text-sm text-zinc-700">{Object.entries(ROLE_HELP).map(([r, t]) => <li key={r}><b>{r}</b>: {t}</li>)}</ul>
      </Card>
      {isAdmin ? (
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold text-zinc-950">Add a member</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={inputClass} placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Full name" />
            <input className={inputClass} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="Email" />
            <input className={inputClass} type="password" placeholder="Password (8+ characters)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-label="Password" autoComplete="new-password" />
            <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Role">{["recruiter", "viewer", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </div>
          <Button variant="primary" disabled={!form.name || !form.email || form.password.length < 8} loading={busy} onClick={() => void run(async () => { await hunt.addMember(form); setForm({ email: "", name: "", password: "", role: "recruiter" }); }, "Member added.")}>Add member</Button>
        </Card>
      ) : team && <Notice tone="amber">Only an admin can add members or change roles.</Notice>}
    </div>
  );
}
