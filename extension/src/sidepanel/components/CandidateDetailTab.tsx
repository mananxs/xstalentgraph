import { useCallback, useEffect, useState } from "react";
import { K, type DetailState, type ProfileSnapshot } from "../../shared/types";
import { call, scoreColor, useStorage } from "../lib";
import { Pill } from "../Pill";

const FIT: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-800",
  ok: "bg-amber-50 text-amber-800",
  risk: "bg-rose-50 text-rose-800",
  unknown: "bg-slate-100 text-slate-600",
};

export default function CandidateDetailTab({ tabId }: { tabId: number | null }) {
  const d = useStorage<DetailState>("session", tabId === null ? null : K.detail(tabId));
  // What the open Resdex profile shows RIGHT NOW (phone / e-mail / CV links). Re-read on demand: a number revealed after the audit
  // is picked up here and, again, at the moment of saving.
  const [live, setLive] = useState<ProfileSnapshot | null>(null);
  const [cvErr, setCvErr] = useState("");
  const refresh = useCallback(async () => {
    if (tabId === null) return;
    setLive(await call<ProfileSnapshot>({ type: "READ_PROFILE", tabId }).catch(() => null));
  }, [tabId]);
  useEffect(() => {
    if (d?.key) void refresh();
  }, [d?.key, refresh]);

  if (!d) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
        Open a candidate profile on Resdex (or click “Deep audit” on a ranked candidate) to see the full AI breakdown.
      </p>
    );
  }
  if (d.status === "loading") {
    return (
      <div className="space-y-2 rounded-lg bg-white p-4 shadow-sm" aria-busy>
        <p className="text-xs font-medium text-slate-600">Auditing {d.label} with AI…</p>
        {[90, 70, 80, 60].map((w) => (
          <div key={w} className="h-4 animate-pulse rounded bg-slate-200" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (d.status === "error" || !d.audit) {
    return (
      <div className="space-y-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">
        <p>{d.error ?? "Audit failed."}</p>
        {tabId !== null && (
          <button className="btn-ghost" onClick={() => void call({ type: "ANALYZE_TEXT", tabId, rawText: d.rawText, label: d.label, url: d.url }).catch(() => {})}>
            Retry
          </button>
        )}
      </div>
    );
  }

  const a = d.audit;
  const x = a.extracted;
  const save = d.save;

  return (
    <div className="space-y-3 pb-24">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{x.fullName || d.label}</h3>
            <p className="truncate text-xs text-slate-500">{[x.currentRole, x.currentCompany].filter(Boolean).join(" @ ")}</p>
          </div>
          <div className="text-right">
            <div className={`rounded-lg px-2.5 py-1 text-lg font-bold leading-none text-white ${scoreColor(a.score)}`}>{a.score}%</div>
            <div className="mt-1 text-[11px] font-medium text-slate-600">{a.tier}</div>
          </div>
        </div>
        <p className="mt-2 text-[12px] text-slate-700">{a.verdict}</p>
      </div>

      <ContactBlock phone={d.save?.contact?.phone ?? live?.phones[0] ?? x.phone} email={d.save?.contact?.email ?? live?.emails[0] ?? x.email} masked={!!live?.phoneMasked && !live.phones.length && !x.phone} onRefresh={() => void refresh()} />

      <Block title="Matched skills">
        {a.matchedSkills.length ? a.matchedSkills.map((s) => <Pill key={s} tone="green">{s}</Pill>) : <span className="text-xs text-slate-400">None</span>}
      </Block>
      <Block title="Missing / gap skills">
        {a.missingSkills.length ? a.missingSkills.map((s) => <Pill key={s} tone="red">{s}</Pill>) : <span className="text-xs text-slate-400">No gaps found</span>}
      </Block>

      <div className="space-y-1.5 text-[12px]">
        <div className={`rounded-md p-2 ${FIT[a.noticeFit]}`}>
          <b>Notice period{x.noticePeriod ? ` (${x.noticePeriod})` : ""}:</b> {a.noticeNote}
        </div>
        <div className={`rounded-md p-2 ${FIT[a.ctcFit]}`}>
          <b>CTC{x.currentCtcLpa >= 0 ? ` (${x.currentCtcLpa} → ${x.expectedCtcLpa >= 0 ? x.expectedCtcLpa : "?"} LPA)` : ""}:</b> {a.ctcNote}
        </div>
        <div className="rounded-md bg-slate-100 p-2 text-slate-700">
          <b>Experience{x.totalExpYears >= 0 ? ` (${x.totalExpYears} yrs)` : ""}:</b> {a.experienceNote}
        </div>
      </div>

      <List title="Strengths" items={a.strengths} />
      <List title="Risks" items={a.risks} />
      <List title="Interview talking points" items={a.interviewQuestions} ordered />

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        {save?.status === "saved" ? (
          <div className="rounded-md bg-emerald-50 p-2 text-center text-xs text-emerald-800">
            ✓ {save.duplicate ? "Already shortlisted — scorecard refreshed." : "Saved to your pipeline."}
            {save.contact?.phone ? ` Mobile ${save.contact.phone} captured.` : save.contact?.phoneMasked ? " Mobile is still hidden by Resdex — unlock it, then Save again." : " No mobile number on the profile."}{" "}
            {save.webUrl && (
              <a className="font-semibold underline" href={save.webUrl} target="_blank" rel="noreferrer">
                View pipeline ↗
              </a>
            )}
            <div className="mt-1.5 text-left text-[11px] text-slate-700">
              {save.cv?.status === "saved" ? (
                <span>📎 CV stored on the platform{save.cv.fileName ? ` (${save.cv.fileName})` : ""}{save.cv.phoneFromCv ? " — mobile number taken from the CV" : ""}.</span>
              ) : save.cv?.status === "none" || (live && live.open && !live.cvLinks.length) ? (
                <span>The profile text is saved with the candidate. No CV download link is visible on this page.</span>
              ) : (
                <>
                  <button
                    className="rounded border border-emerald-400 bg-white px-2 py-0.5 font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                    disabled={save.cv?.status === "fetching" || tabId === null}
                    title="Downloads the CV through your own Resdex session (like clicking the link) and stores it with the candidate. Only runs when you press this."
                    onClick={() => {
                      setCvErr("");
                      if (tabId !== null) void call({ type: "ATTACH_CV", tabId }).catch((e: Error) => setCvErr(e.message));
                    }}
                  >
                    {save.cv?.status === "fetching" ? "Fetching CV…" : "📎 Attach CV file"}
                  </button>
                  <span className="ml-1.5 text-slate-500">uses your Resdex session; may count toward your CV-download quota</span>
                  {(cvErr || save.cv?.error) && <p className="mt-1 text-rose-600">{cvErr || save.cv?.error}</p>}
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <button
              className="btn-primary w-full"
              disabled={save?.status === "saving" || tabId === null}
              onClick={() => tabId !== null && void call({ type: "SAVE_CANDIDATE", tabId }).catch(() => {})}
            >
              {save?.status === "saving" ? "Saving…" : "Save & Shortlist (with mobile + profile)"}
            </button>
            {save?.status === "error" && <p className="mt-1 text-center text-xs text-rose-600">{save.error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function List({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items.length) return null;
  const Tag = ordered ? "ol" : "ul";
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <Tag className={`${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-4 text-[12px] text-slate-700`}>
        {items.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </Tag>
    </div>
  );
}

function ContactBlock({ phone, email, masked, onRefresh }: { phone?: string | null; email?: string | null; masked: boolean; onRefresh: () => void }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 text-[12px]">
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Contact</h4>
        <button className="text-[11px] text-indigo-600 hover:underline" onClick={onRefresh} title="Re-read the open profile (e.g. after you unlocked the number)">
          ↻ Re-check
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        <span>
          📱 {phone ? <b className="font-semibold text-slate-800">{phone}</b> : <span className="text-slate-400">{masked ? "hidden by Resdex" : "not shown"}</span>}
        </span>
        <span className="truncate">✉ {email ? <b className="font-semibold text-slate-800">{email}</b> : <span className="text-slate-400">not shown</span>}</span>
      </div>
      {!phone && masked && <p className="mt-1 text-[11px] text-amber-700">Resdex hides the number until you unlock the contact details on the profile. Unlock it there, press Re-check, then Save — it is read at the moment you save.</p>}
    </div>
  );
}
