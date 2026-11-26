/**
 * Human-triggered "Fill Resdex Search": types the job's FULL search plan into the Resdex form — Boolean query (switching Boolean
 * mode on when there is a toggle), all/any/exclude keyword boxes, designation, location, experience, salary, notice period, education.
 *
 * Runs ONLY when the recruiter presses the button in the side panel. It sets field values with the native setter and fires input/change
 * so Angular/React-controlled forms register them; it may flip form controls (the Boolean switch, notice-period options) but it never
 * presses Enter, never clicks Search/Apply and never submits — the recruiter reviews and searches.
 * Every field reports filled / manual / missing, so a layout difference is visible instead of silently ignored.
 */
import type { FillField, FillKey, FillReport, SearchFill } from "../shared/types";
import { describe, formFields, PILL_HOST_ATTR, setValue, type Field } from "./formFields";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const txt = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const EXP = /exp|year|yrs/;
const NOT_EXP = /salary|ctc|lac|lakh|notice|keyword|skill|location|city|designation/;
const NOT_KW = /location|city|cities|\bexp|experience|salary|ctc|lac|lakh|notice|company|employer|institute|college|designation|education|qualification|\bage\b/;

const ALL_KEYS: FillKey[] = ["boolean", "keywords", "anyKeywords", "excludeKeywords", "designation", "minExp", "maxExp", "location", "minSalary", "maxSalary", "notice", "education"];

/* ───────── toggles (Boolean switch, option rows) ───────── */

const TOGGLE_SEL = 'input[type=checkbox],input[type=radio],[role=switch],[role=checkbox],[role=radio],[role=tab],[role=option],button,label';

function labelOf(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) {
    const bits: string[] = [el.getAttribute("aria-label") ?? ""];
    if (el.id) document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => bits.push(l.textContent ?? ""));
    const wrap = el.closest("label");
    if (wrap) bits.push(wrap.textContent ?? "");
    bits.push(el.nextElementSibling?.textContent ?? el.nextSibling?.textContent ?? "");
    return txt(bits.find((b) => txt(b)) ?? el.value);
  }
  return txt(el.getAttribute("aria-label")) || txt(el.textContent);
}

function isOn(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return el.checked;
  for (const a of ["aria-checked", "aria-pressed", "aria-selected"]) if (el.getAttribute(a) === "true") return true;
  return /\b(active|selected|checked|is-on|toggled)\b/i.test(el.getAttribute("class") ?? "");
}

/** The actual clickable control for a <label> (its input, or the label itself). */
function controlOf(el: HTMLElement): HTMLElement {
  if (el instanceof HTMLLabelElement) {
    const c = el.control ?? el.querySelector<HTMLElement>("input");
    if (c) return c;
  }
  return el;
}

function findToggle(re: RegExp, maxLen = 60): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(TOGGLE_SEL)) {
    if (el.closest(`[${PILL_HOST_ATTR}]`)) continue;
    const t = labelOf(el);
    if (t && t.length <= maxLen && re.test(t)) {
      const c = controlOf(el);
      const r = c.getBoundingClientRect();
      if ((r.width > 0 && r.height > 0) || el.getBoundingClientRect().width > 0) return c;
    }
  }
  return null;
}

/** Ensures a switch/checkbox/tab is ON. Returns whether it is on afterwards. (A radio/tab is only ever clicked ON, never off.) */
async function ensureOn(el: HTMLElement): Promise<boolean> {
  if (!isOn(el)) {
    el.click();
    await sleep(250); // the form may re-render (e.g. a Boolean box replaces the keyword chips)
  }
  return isOn(el) || el.getAttribute("role") === "tab";
}

/* ───────── notice period ───────── */

/** "Immediate" → 0, "15 days" → 15, "1 month" → 30, "less than 3 months" → 90 … null when no duration. */
export function daysOf(text: string): number | null {
  const t = text.toLowerCase();
  if (/immediate|serving|available now|\b0\s*day/.test(t)) return 0;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(day|week|month)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Math.round(m[2] === "day" ? n : m[2] === "week" ? n * 7 : n * 30);
}

async function fillNotice(maxDays: number): Promise<{ status: FillField["status"]; detail?: string }> {
  // 1. a <select> labelled notice
  const sel = formFields().find(({ el, d }) => el instanceof HTMLSelectElement && /notice/.test(d));
  if (sel && sel.el instanceof HTMLSelectElement) {
    const opts = [...sel.el.options].map((o) => ({ o, d: daysOf(o.textContent ?? "") })).filter((x): x is { o: HTMLOptionElement; d: number } => x.d !== null && x.d <= maxDays);
    const best = opts.sort((a, b) => b.d - a.d)[0];
    if (best && setValue(sel.el, txt(best.o.textContent))) return { status: "filled", detail: txt(best.o.textContent) };
    return { status: "manual", detail: `No option ≤ ${maxDays} days in the dropdown` };
  }
  // 2. a group of checkbox/radio options under a "Notice period" heading
  const heading = [...document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,legend,summary,label,span,div,p")].find(
    (h) => !h.closest(`[${PILL_HOST_ATTR}]`) && h.children.length === 0 && /^notice( period)?\b/i.test(txt(h.textContent)) && txt(h.textContent).length <= 40,
  );
  if (!heading) return { status: "missing" };
  let scope: HTMLElement | null = heading.parentElement;
  let inputs: HTMLInputElement[] = [];
  for (let i = 0; scope && i < 4; i++, scope = scope.parentElement) {
    inputs = [...scope.querySelectorAll<HTMLInputElement>("input[type=checkbox],input[type=radio]")];
    if (inputs.length) break;
  }
  const options = inputs.map((el) => ({ el, d: daysOf(labelOf(el)) })).filter((x): x is { el: HTMLInputElement; d: number } => x.d !== null && x.d <= maxDays);
  if (!options.length) return { status: "manual", detail: `No notice option ≤ ${maxDays} days found` };
  const radio = options[0].el.type === "radio";
  const chosen = radio ? [options.sort((a, b) => b.d - a.d)[0]] : options;
  for (const { el } of chosen) if (!el.checked) { el.click(); await sleep(120); }
  return { status: "filled", detail: chosen.map((c) => labelOf(c.el)).join(", ") };
}

/* ───────── main ───────── */

export async function fillSearchFields(input: SearchFill): Promise<FillReport> {
  const f: Required<SearchFill> = {
    booleanQuery: input.booleanQuery ?? "",
    minExp: input.minExp ?? null,
    maxExp: input.maxExp ?? null,
    locations: input.locations ?? [],
    allKeywords: input.allKeywords ?? [],
    anyKeywords: input.anyKeywords ?? [],
    excludeKeywords: input.excludeKeywords ?? [],
    designations: input.designations ?? [],
    minSalary: input.minSalary ?? null,
    maxSalary: input.maxSalary ?? null,
    maxNoticeDays: input.maxNoticeDays ?? null,
    education: input.education ?? "",
    useBoolean: input.useBoolean ?? true,
  };
  const rep: FillReport = { ok: false, filled: Object.fromEntries(ALL_KEYS.map((k) => [k, false])) as Record<FillKey, boolean>, fields: [], notes: [] };
  const done = (key: FillKey, label: string, status: FillField["status"], detail?: string) => {
    rep.fields.push({ key, label, status, detail });
    if (status === "filled") rep.filled[key] = true;
  };

  /* 1. Boolean mode */
  let booleanOn = false;
  if (f.booleanQuery.trim() && f.useBoolean) {
    const sw = findToggle(/boolean/i);
    if (sw) {
      booleanOn = await ensureOn(sw);
      done("boolean", "Boolean mode", booleanOn ? "filled" : "manual", booleanOn ? "switched on" : "couldn't confirm the switch is on");
    } else done("boolean", "Boolean mode", "missing", "no Boolean switch on this page — the query still goes in the keyword box");
  }

  const fields = formFields(); // read AFTER the toggle: switching mode can replace the inputs
  const used = new Set<Field>();
  const pick = (test: (d: string, el: Field) => boolean, avoid?: RegExp) => {
    const hit = fields.find(({ el, d }) => !used.has(el) && test(d, el) && !(avoid && avoid.test(d)));
    if (hit) used.add(hit.el);
    return hit?.el ?? null;
  };
  const text = (el: Field) => !(el instanceof HTMLSelectElement);

  /* 2. experience / salary ranges first, so the keyword picker can't grab those boxes */
  const range = (kind: RegExp, avoid: RegExp) => {
    let min = pick((d) => /\bmin|from|minimum/.test(d) && kind.test(d), avoid);
    let max = pick((d) => /\bmax|\bto\b|maximum/.test(d) && kind.test(d), avoid);
    if (!min && !max) {
      const pair = fields.filter(({ el, d }) => !used.has(el) && kind.test(d) && !avoid.test(d));
      if (pair.length === 2) {
        min = pair[0].el;
        max = pair[1].el;
        used.add(min).add(max);
      }
    }
    // only one side labelled ("Experience [Min] [—]") → the adjacent field in the same small group is the other side
    const neighbour = (from: Field, dir: 1 | -1): Field | null => {
      const i = fields.findIndex((x) => x.el === from);
      const n = fields[i + dir];
      if (!n || used.has(n.el) || /location|city|salary|ctc|lac|lakh|notice|keyword|skill|designation/.test(n.d)) return null;
      const group = from.parentElement?.parentElement;
      return group && group.contains(n.el) ? n.el : null;
    };
    if (min && !max) {
      max = neighbour(min, 1);
      if (max) used.add(max);
    } else if (max && !min) {
      min = neighbour(max, -1);
      if (min) used.add(min);
    }
    return [min, max] as const;
  };
  const put = (key: FillKey, label: string, el: Field | null, value: number | string | null, unit = "") => {
    if (value === null || value === "") return;
    if (el && setValue(el, String(value))) done(key, label, "filled", `${value}${unit}`);
    else done(key, label, el ? "manual" : "missing", el ? "dropdown has no matching option" : "field not found");
  };

  const [expMin, expMax] = range(EXP, NOT_EXP);
  put("minExp", "Min experience", expMin, f.minExp, " yrs");
  put("maxExp", "Max experience", expMax, f.maxExp, " yrs");

  if (f.minSalary !== null || f.maxSalary !== null) {
    const [salMin, salMax] = range(/salary|ctc|lac|lakh|lpa/, /notice|keyword|skill|location|city|designation|experience/);
    put("minSalary", "Min salary", salMin, f.minSalary, " LPA");
    put("maxSalary", "Max salary", salMax, f.maxSalary, " LPA");
  }

  /* 3. location (Resdex's location boxes are typeaheads: the first value is typed, the rest are listed for the recruiter) */
  if (f.locations.length) {
    const locEl = pick((d, el) => /current\s*location|location|city|cities/.test(d) && !(el instanceof HTMLSelectElement && el.options.length > 60), /keyword|skill|designation|preferred|relocat/) ?? pick((d) => /preferred\s*location|location|city/.test(d), /keyword|skill|designation/);
    if (locEl && setValue(locEl, f.locations[0])) {
      done("location", "Location", f.locations.length > 1 ? "manual" : "filled", `typed "${f.locations[0]}"`);
      rep.filled.location = true;
      if (f.locations.length > 1) rep.notes.push(`Location: typed "${f.locations[0]}" — add ${f.locations.slice(1).join(", ")} from the Resdex suggestions.`);
    } else done("location", "Location", "missing", f.locations.join(", "));
  }

  /* 4. designation */
  if (f.designations.length) {
    const el = pick((d) => /designation|job\s*title|current\s*role|\brole\b/.test(d), /keyword|skill|location|city|employer|company|exp|salary|notice/);
    if (el && setValue(el, f.designations[0])) {
      done("designation", "Designation", f.designations.length > 1 ? "manual" : "filled", `typed "${f.designations[0]}"`);
      rep.filled.designation = true;
      if (f.designations.length > 1) rep.notes.push(`Designation: typed "${f.designations[0]}" — also consider ${f.designations.slice(1).join(", ")}.`);
    } else done("designation", "Designation", "missing", f.designations.join(", "));
  }

  /* 5. keywords */
  const kwAll = pick((d, el) => text(el) && /(all|must|mandatory)\b[^a-z]*(of )?(these )?keyword|all keywords|must have/.test(d), NOT_KW);
  const kwAny = pick((d, el) => text(el) && /(any|optional|at least)\b[^a-z]*(of )?(these )?keyword|any keywords|good to have/.test(d), NOT_KW);
  const kwExc = pick((d, el) => text(el) && /exclude|not these|without/.test(d), /location|city|company|employer/);
  const kwGeneric = () =>
    pick((d, el) => text(el) && /keyword|boolean|skill|search/.test(d), NOT_KW) ??
    pick((d, el) => el instanceof HTMLInputElement && el.type === "search", /location|city/);

  const q = f.booleanQuery.trim();
  const useBooleanBox = !!q && (booleanOn || (!kwAll && !kwAny));
  if (useBooleanBox) {
    const el = kwAll ?? kwGeneric();
    if (el && setValue(el, q)) done("keywords", "Boolean query", "filled", q.length > 70 ? `${q.slice(0, 67)}…` : q);
    else done("keywords", "Boolean query", "missing", "keyword box not found — paste the query manually");
  } else {
    // separate boxes mode: lists, comma separated (a chip widget may still need the recruiter to confirm each chip)
    const list = (xs: string[]) => xs.join(", ");
    if (f.allKeywords.length) put("keywords", "All keywords", kwAll ?? kwGeneric(), list(f.allKeywords));
    if (f.anyKeywords.length) put("anyKeywords", "Any keywords", kwAny, list(f.anyKeywords));
    if (f.excludeKeywords.length) put("excludeKeywords", "Exclude keywords", kwExc, list(f.excludeKeywords));
  }
  if (useBooleanBox && f.excludeKeywords.length && kwExc && !booleanOn) put("excludeKeywords", "Exclude keywords", kwExc, f.excludeKeywords.join(", "));

  /* 6. notice period (clicks the matching option(s); never Apply) */
  if (f.maxNoticeDays !== null) {
    const n = await fillNotice(f.maxNoticeDays);
    done("notice", "Notice period", n.status, n.detail ?? `≤ ${f.maxNoticeDays} days`);
  }

  /* 7. education (only when the JD makes it mandatory) */
  if (f.education.trim()) {
    const el = pick((d, el) => text(el) && /education|qualification|degree|course/.test(d), /keyword|skill|location|city|employer|company|institute|college/);
    if (el && setValue(el, f.education.trim())) done("education", "Education", "manual", `typed "${f.education.trim()}" — confirm the suggestion`);
    else done("education", "Education", "missing", f.education.trim());
  }

  rep.ok = rep.fields.some((x) => x.status === "filled" || x.status === "manual");
  const problems = rep.fields.filter((x) => x.status !== "filled");
  if (!rep.ok || problems.length) {
    const seen = fields.slice(0, 10).map(({ el }) => el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("name") || el.id || el.tagName.toLowerCase());
    if (seen.length) rep.notes.push(`Fields seen on this page: ${seen.join(" | ")} — use “Copy form map” in the panel and send it to your admin to tune the matcher.`);
  }
  if (!rep.ok) rep.error = "Couldn't find the Resdex search fields on this page. Open the Resdex search page first.";
  return rep;
}

/**
 * Diagnostic for layout differences: a compact description (labels, placeholders, types, option texts, toggles) of every visible
 * control — NO typed values — that can be pasted to whoever maintains the matcher.
 */
export function mapForm() {
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && !el.closest(`[${PILL_HOST_ATTR}]`);
  };
  const controls = [...document.querySelectorAll<Field>("input,select,textarea")].filter(vis).slice(0, 150).map((el) => ({
    tag: el.tagName.toLowerCase(),
    type: (el as HTMLInputElement).type ?? "",
    descriptor: describe(el).slice(0, 160),
    options: el instanceof HTMLSelectElement ? [...el.options].slice(0, 12).map((o) => txt(o.textContent)) : undefined,
    checked: el instanceof HTMLInputElement && /checkbox|radio/.test(el.type) ? el.checked : undefined,
    label: el instanceof HTMLInputElement && /checkbox|radio/.test(el.type) ? labelOf(el).slice(0, 60) : undefined,
  }));
  const toggles = [...document.querySelectorAll<HTMLElement>('[role=switch],[role=tab],[role=checkbox],button[aria-pressed]')].filter(vis).slice(0, 60).map((el) => ({ role: el.getAttribute("role") ?? el.tagName.toLowerCase(), text: txt(el.textContent).slice(0, 50), on: isOn(el) }));
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,legend")].filter(vis).slice(0, 40).map((h) => txt(h.textContent).slice(0, 50));
  return { url: location.origin + location.pathname, controls, toggles, headings };
}
