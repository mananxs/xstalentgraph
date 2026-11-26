import type { ActiveJob, JobSummary, Rubric, SearchFill, SearchState } from "../shared/types";
import { hashStr } from "../shared/util";

const nn = (n: number | undefined | null) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);
const term = (s: string) => {
  const t = s.replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
  return /\s/.test(t) ? `"${t}"` : t;
};

/**
 * Resolves the Resdex search fields for ANY rubric the server returns.
 * Jobs saved before the Boolean upgrade have no `booleanQuery`/`minExp` → rebuilt from the legacy fields
 * (same fallback the server uses in lib/resdexQuery.ts → resdexSearchParams).
 */
export function resolveSearch(r: Rubric | null | undefined): { booleanQuery: string; minExp: number | null; maxExp: number | null; locations: string[] } {
  if (!r) return { booleanQuery: "", minExp: null, maxExp: null, locations: [] };
  let q = (r.booleanQuery ?? "").trim();
  if (!q) {
    const core = (r.mustHaveKeywords?.length ? r.mustHaveKeywords : r.mustHaveSkills).slice(0, 5).map(term).filter(Boolean);
    q = core.join(" AND ");
    const ex = (r.excludeKeywords ?? []).slice(0, 5).map(term).filter(Boolean);
    if (q && ex.length) q += ex.length > 1 ? ` NOT (${ex.join(" OR ")})` : ` NOT ${ex[0]}`;
  }
  return { booleanQuery: q, minExp: nn(r.minExp) ?? nn(r.minExperienceYears), maxExp: nn(r.maxExp) ?? nn(r.maxExperienceYears), locations: (r.locations ?? []).filter(Boolean).slice(0, 5) };
}

/** The editable Resdex form in the panel (strings, because they are text inputs). Defaults come from the SERVER's plan for the job. */
export interface Draft {
  q: string; // Boolean query
  min: string;
  max: string;
  loc: string;
  all: string; // comma lists
  any: string;
  exclude: string;
  desig: string;
  maxSal: string; // LPA
  notice: string; // max days
  edu: string;
  bool: boolean; // switch Resdex into Boolean mode
}
const join = (xs?: string[]) => (xs ?? []).join(", ");
const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export const draftOf = (j: ActiveJob): Draft => {
  const p = j.search;
  return {
    q: p?.booleanQuery ?? j.booleanQuery ?? j.coreKeywords.slice(0, 4).join(" "),
    min: str(p ? p.minExp : j.minExp),
    max: str(p ? p.maxExp : j.maxExp),
    loc: join(p?.locations ?? j.locations),
    all: join(p?.allKeywords),
    any: join(p?.anyKeywords),
    exclude: join(p?.excludeKeywords),
    desig: join(p?.designations),
    maxSal: str(p?.maxSalary),
    notice: str(p?.maxNoticeDays),
    edu: p?.education ?? "",
    bool: true,
  };
};

/** A stored draft from an older build may lack the newer fields — fill them from the job's plan. */
export const completeDraft = (stored: Partial<Draft>, job: ActiveJob): Draft => ({ ...draftOf(job), ...stored });

const numOrNull = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) || Number(s) < 0 ? null : Number(s));
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Panel form → the message the content script executes on the Resdex page. */
export function draftToFill(d: Draft): SearchFill {
  return {
    booleanQuery: d.q.trim(),
    minExp: numOrNull(d.min),
    maxExp: numOrNull(d.max),
    locations: list(d.loc),
    allKeywords: list(d.all),
    anyKeywords: list(d.any),
    excludeKeywords: list(d.exclude),
    designations: list(d.desig),
    minSalary: null,
    maxSalary: numOrNull(d.maxSal),
    maxNoticeDays: numOrNull(d.notice),
    education: d.edu.trim(),
    useBoolean: d.bool,
  };
}

/** Server job → what the content script and panel keep as the "active job". `sig` changes whenever the rubric/plan changes. */
export function toActive(j: JobSummary): ActiveJob {
  const s = resolveSearch(j.rubric);
  return {
    id: j.id,
    title: j.title,
    coreKeywords: j.rubric?.coreKeywords ?? [],
    mustHaveSkills: j.rubric?.mustHaveSkills ?? [],
    sig: hashStr(JSON.stringify({ r: j.rubric ?? {}, h: j.rubricHash ?? "" })),
    booleanQuery: j.search?.booleanQuery ?? s.booleanQuery,
    minExp: j.search ? j.search.minExp : s.minExp,
    maxExp: j.search ? j.search.maxExp : s.maxExp,
    locations: j.search?.locations ?? s.locations,
    search: j.search ?? null,
  };
}

const wrap = (xs: string[]) => (xs.length > 1 ? `(${xs.map(term).join(" OR ")})` : term(xs[0]));

/**
 * Naukri's live search → the panel's query box. Keeps an already-Boolean keyword string as typed; otherwise folds
 * "any of" chips into (a OR b) and excluded chips into NOT (…). A search with no keywords at all leaves the draft's query alone.
 */
export function draftFromLive(live: SearchState, cur: Draft): Draft {
  const parts: string[] = [];
  const kw = live.keywords.trim();
  if (kw) parts.push(kw);
  if (live.anyKeywords.length) parts.push(wrap(live.anyKeywords));
  let q = parts.join(" AND ");
  if (q && live.excludeKeywords.length) q += ` NOT ${wrap(live.excludeKeywords)}`;
  return {
    ...cur,
    q: q || cur.q,
    min: live.minExp !== null ? String(live.minExp) : cur.min,
    max: live.maxExp !== null ? String(live.maxExp) : cur.max,
    loc: live.location || cur.loc,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export const sameDraft = (a: Draft, b: Draft) => norm(a.q) === norm(b.q) && a.min === b.min && a.max === b.max && norm(a.loc) === norm(b.loc);

/** One-line summary of a Naukri search for the panel header. */
export function describeSearch(s: SearchState): string[] {
  const out: string[] = [];
  const kw = [s.keywords, ...s.anyKeywords.map((k) => `~${k}`), ...s.excludeKeywords.map((k) => `−${k}`)].filter(Boolean).join(" ");
  if (kw) out.push(kw.length > 70 ? `${kw.slice(0, 67)}…` : kw);
  if (s.location) out.push(s.location);
  if (s.minExp !== null || s.maxExp !== null) out.push(`${s.minExp ?? 0}–${s.maxExp ?? "∞"} yrs`);
  if (s.minSalary !== null || s.maxSalary !== null) out.push(`${s.minSalary ?? 0}–${s.maxSalary ?? "∞"} LPA`);
  const f = s.filters.filter((x) => !x.label.startsWith("url:")).length;
  if (f) out.push(`${f} filter${f > 1 ? "s" : ""}`);
  return out;
}
