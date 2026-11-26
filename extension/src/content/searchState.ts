/**
 * Reads the Naukri Resdex search the recruiter is looking at: the keyword boxes (+ chips), location, experience, salary and every
 * selected filter in the filter panels — plus the URL's own query parameters. READ-ONLY: it never types, clicks or submits.
 *
 * Resdex is a single-page app with obfuscated class names, so nothing here depends on CSS classes. Controls are identified by what a
 * human sees (placeholder / aria-label / <label> / the short text before them), "selected" is read from the standard signals
 * (checked, aria-checked/pressed/selected, selected <option>), and filters are grouped under the nearest heading above them.
 */
import type { SearchState } from "../shared/types";
import { describe, formFields, PILL_HOST_ATTR, type Field } from "./formFields";

const EXP = /exp|year|yrs/;
const SAL = /salary|ctc|lac|lakh|lpa/;
const LOC = /location|city|cities/;
const KW = /keyword|boolean|skill|designation|role|search/;
const NOT_KW = /location|city|cities|\bexp|experience|salary|ctc|lac|lakh|lpa|notice|company|employer|institute|college|age\b|gender/;
const CHIP_SEL = '[class*="chip" i],[class*="tag" i],[class*="token" i],[class*="pill" i],[class*="badge" i],[class*="selected-item" i],[class*="multi-value" i]';
const NOISE_PARAM = /^(utm_|_ga|fbclid|gclid|token|ts$|timestamp|_$|sid$|cb$)/i;
const PAGE_PARAM = /^(page|pageno|pagenumber|pg|start|offset|p)$/i;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").replace(/[×✕✖]/g, "").trim();
const num = (s: string | null | undefined): number | null => {
  const m = clean(s).match(/-?\d+(?:\.\d+)?/);
  const n = m ? parseFloat(m[0]) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Current value of a control as text; for a <select> the chosen option's text unless it is the placeholder ("Any", "Select", ""). */
function valueOf(el: Field): string {
  if (el instanceof HTMLSelectElement) {
    const o = el.selectedOptions[0];
    if (!o || !o.value.trim() || el.selectedIndex === 0 && /^(any|select|choose|all|none|--)/i.test(clean(o.textContent))) return "";
    return clean(o.textContent);
  }
  return clean(el.value);
}

/** Chip/tag texts rendered next to a (multi-value) input, e.g. the keywords already added to the box. */
function chipsNear(el: Field): string[] {
  const out: string[] = [];
  const visibleField = (x: Element) => {
    const f = x as HTMLInputElement;
    if (f.type === "hidden" || f.hidden) return false;
    const r = f.getBoundingClientRect();
    return r.width > 20 && r.height > 10;
  };
  let scope: HTMLElement | null = el.parentElement;
  for (let depth = 0; scope && depth < 3; depth++, scope = scope.parentElement) {
    // never climb into a container that holds OTHER visible fields — their chips would leak into this field
    if ([...scope.querySelectorAll("input,select,textarea")].some((x) => x !== el && visibleField(x))) break;
    const found = [...scope.querySelectorAll<HTMLElement>(CHIP_SEL)].filter((c) => !c.querySelector("input,select,textarea") && !c.closest(`[${PILL_HOST_ATTR}]`) && !c.querySelector(CHIP_SEL));
    for (const c of found) {
      const t = clean(c.textContent);
      if (t.length >= 1 && t.length <= 60 && !/^(x|close|clear|remove|add)$/i.test(t)) out.push(t);
    }
    if (out.length) break;
  }
  return [...new Set(out)];
}

/** [min, max] among range-like fields (two boxes labelled min/max, "from/to", or an unlabelled adjacent pair). */
function rangeOf(fields: { el: Field; d: string }[], kind: RegExp, notKind: RegExp): [number | null, number | null] {
  const mine = fields.filter(({ d }) => kind.test(d) && !notKind.test(d));
  if (!mine.length) return [null, null];
  const min = mine.find(({ d }) => /\bmin|from|minimum|\blow/.test(d));
  const max = mine.find(({ d }) => /\bmax|\bto\b|maximum|\bhigh/.test(d));
  if (min || max) return [min ? num(valueOf(min.el)) : null, max ? num(valueOf(max.el)) : null];
  if (mine.length === 2) return [num(valueOf(mine[0].el)), num(valueOf(mine[1].el))];
  if (mine.length === 1) return [num(valueOf(mine[0].el)), null];
  return [null, null];
}

/* ───────── filters ───────── */

const isHeadingEl = (c: Element) =>
  (/^(H[1-6]|LEGEND|SUMMARY)$/.test(c.tagName) || (/title|heading|header|label|name/i.test(c.getAttribute("class") ?? "") && !c.querySelector("input,select,textarea"))) &&
  clean(c.textContent).length > 0 &&
  clean(c.textContent).length <= 40;

function groupLabel(el: Element): string {
  let a: Element | null = el.parentElement;
  for (let i = 0; a && i < 6; i++, a = a.parentElement) {
    const h = [...a.children].find((c) => !c.contains(el) && isHeadingEl(c));
    if (h) return clean(h.textContent);
  }
  return "";
}

/**
 * Result cards also contain checkboxes ("select candidate") — those are not search filters.
 * An ancestor counts as a CARD only if it looks like one (experience + pay/notice text) AND is a leaf-ish container: it holds no
 * text inputs/selects (so not the page or the filter panel) and at most two checkboxes (so not a list of filter options).
 */
function insideCard(el: Element): boolean {
  let a: Element | null = el.parentElement;
  for (let i = 0; a && i < 8; i++, a = a.parentElement) {
    if (/^(BODY|HTML|MAIN|ASIDE|NAV|HEADER|FORM)$/.test(a.tagName)) return false;
    if (a.querySelector("input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea")) return false;
    if (a.querySelectorAll("input[type=checkbox],input[type=radio],[role=checkbox]").length > 2) return false;
    const t = (a as HTMLElement).innerText ?? "";
    if (t.length > 250 && t.length < 6000 && /\b\d{1,2}(?:\.\d)?\s*\+?\s*(yrs?|years?)\b/i.test(t) && /notice|lacs?|lpa|₹/i.test(t)) return true;
  }
  return false;
}

/** The option's OWN text ("15 days or less") — label[for], the wrapping <label>, or the text right after the box; never a section heading. */
function optionLabel(el: HTMLInputElement): string {
  const bits: string[] = [];
  if (el.id) document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => bits.push(l.textContent ?? ""));
  const wrap = el.closest("label");
  if (wrap) bits.push(wrap.textContent ?? "");
  bits.push(el.nextElementSibling?.textContent ?? el.nextSibling?.textContent ?? "");
  return bits.map(clean).find(Boolean) || clean(el.getAttribute("aria-label")) || clean(el.value);
}

function readFilters(skip: Set<Element>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: string) => {
    const v = clean(value);
    if (!v || v.length > 120 || /^(select|choose|apply|reset|clear|search|more|less|show|hide)\b/i.test(v) || /select (all|candidate)|compare|bulk/i.test(v)) return;
    const k = `${label.toLowerCase()}|${v.toLowerCase()}`;
    if (seen.has(k) || out.length >= 80) return;
    seen.add(k);
    out.push({ label: clean(label).slice(0, 100), value: v.slice(0, 280) });
  };

  // 1. checked checkboxes / radios
  document.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked, input[type=radio]:checked").forEach((el) => {
    if (skip.has(el) || el.closest(`[${PILL_HOST_ATTR}]`) || insideCard(el)) return;
    push(groupLabel(el), optionLabel(el));
  });
  // 2. ARIA toggles that are not native inputs (custom checkboxes, option chips, toggle buttons)
  document.querySelectorAll<HTMLElement>('[aria-checked="true"],[aria-pressed="true"],[aria-selected="true"]').forEach((el) => {
    if (el instanceof HTMLInputElement || skip.has(el) || el.closest(`[${PILL_HOST_ATTR}]`) || el.getAttribute("role") === "tab" || insideCard(el)) return;
    const t = clean(el.getAttribute("aria-label")) || clean(el.textContent);
    if (t && t.length <= 60) push(groupLabel(el), t);
  });
  // 3. <select> filters that are not one of the main search fields
  document.querySelectorAll<HTMLSelectElement>("select").forEach((el) => {
    if (skip.has(el) || el.closest(`[${PILL_HOST_ATTR}]`)) return;
    const v = valueOf(el);
    if (v) push(clean(describe(el)).slice(0, 60) || groupLabel(el), v);
  });
  return out;
}

function urlFilters(): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const add = (qs: string) => {
    for (const [k, v] of new URLSearchParams(qs)) {
      if (!v || v.length > 120 || NOISE_PARAM.test(k) || PAGE_PARAM.test(k)) continue;
      out.push({ label: `url:${k}`, value: v });
    }
  };
  add(location.search);
  const h = location.hash.indexOf("?");
  if (h >= 0) add(location.hash.slice(h));
  return out;
}

function readPage(): number | null {
  const sp = new URLSearchParams(location.search);
  for (const k of sp.keys()) if (PAGE_PARAM.test(k)) return num(sp.get(k));
  const cur = document.querySelector<HTMLElement>('[aria-current="page"]');
  return cur ? num(cur.textContent) : null;
}

/* ───────── main reader ───────── */

export function readSearchState(): SearchState {
  const fields = formFields();
  const used = new Set<Element>();
  const use = (xs: { el: Field }[]) => xs.forEach((x) => used.add(x.el));

  // experience / salary ranges first, so the keyword picker cannot grab those boxes
  const expF = fields.filter(({ d }) => EXP.test(d) && !SAL.test(d) && !/notice|keyword|skill|location|city/.test(d));
  const [minExp, maxExp] = rangeOf(fields, EXP, /salary|ctc|lac|lakh|notice|keyword|skill|location|city/);
  use(expF);
  const salF = fields.filter(({ d }) => SAL.test(d));
  const [minSalary, maxSalary] = rangeOf(fields, SAL, /notice|keyword|skill|location|city/);
  use(salF);

  // location (+ chips of the multi-select)
  const locF = fields.filter(({ el, d }) => LOC.test(d) && !used.has(el) && !/keyword|skill|designation/.test(d) && !(el instanceof HTMLSelectElement && el.options.length > 60));
  use(locF);
  const loc = [...new Set(locF.flatMap(({ el }) => [...valueOf(el).split(/[,;]/), ...chipsNear(el)]).map(clean).filter(Boolean))];

  // keyword boxes: any / exclude / main
  const kwF = fields.filter(({ el, d }) => !used.has(el) && !(el instanceof HTMLSelectElement) && KW.test(d) && !NOT_KW.test(d));
  use(kwF);
  const main: string[] = [];
  const any: string[] = [];
  const exclude: string[] = [];
  for (const { el, d } of kwF) {
    const parts = [valueOf(el), ...chipsNear(el)].map(clean).filter(Boolean);
    (/exclude|\bnot\b|without/.test(d) ? exclude : /\bany\b|at least one|\bor\b/.test(d) ? any : main).push(...parts);
  }

  const filters = [...readFilters(used), ...urlFilters()];
  return {
    keywords: [...new Set(main)].join(" "),
    anyKeywords: [...new Set(any)],
    excludeKeywords: [...new Set(exclude)],
    location: loc.join(", "),
    minExp,
    maxExp,
    minSalary,
    maxSalary,
    filters,
    url: location.origin + location.pathname,
    page: readPage(),
  };
}

/** Stable fingerprint of a search (ignores page number, URL and casing/ordering noise). */
export function searchSignature(s: SearchState, hash: (x: string) => string): string {
  const n = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  const sorted = (a: string[]) => a.map(n).filter(Boolean).sort();
  return hash(
    JSON.stringify({
      k: n(s.keywords),
      a: sorted(s.anyKeywords),
      x: sorted(s.excludeKeywords),
      l: sorted(s.location.split(",")),
      e: [s.minExp, s.maxExp],
      s: [s.minSalary, s.maxSalary],
      f: sorted(s.filters.map((f) => `${n(f.label)}=${n(f.value)}`)),
    }),
  );
}
