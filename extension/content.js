(function() {
  "use strict";
  const DEFAULT_SETTINGS = { analyzedOnly: false, autoSync: true, scoring: false };
  function worthOf(r) {
    return r.worth ?? (r.score >= 80 ? "open" : r.score >= 60 ? "review" : "skip");
  }
  const WORTH_LABEL = {
    open: { short: "Worth 1 CV View", long: "High Priority · Open Profile" },
    review: { short: "Review card", long: "Borderline · Review Card First" },
    skip: { short: "Skip", long: "Skip · Save Quota" }
  };
  const K = {
    // local
    settings: "settings"
  };
  const PILL_HOST_ATTR = "data-ai-pill-host";
  const SKIP_INPUT_TYPES = /* @__PURE__ */ new Set(["checkbox", "radio", "button", "submit", "reset", "file", "hidden", "image", "password", "email", "tel"]);
  function labelText(el) {
    const bits = [];
    if (el.id) document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => bits.push(l.textContent ?? ""));
    const wrap = el.closest("label");
    if (wrap) bits.push(wrap.textContent ?? "");
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) for (const id of labelledBy.split(/\s+/)) bits.push(document.getElementById(id)?.textContent ?? "");
    const prev = el.previousElementSibling ?? (el.parentElement?.children.length === 1 ? el.parentElement.previousElementSibling : null);
    if (prev && !prev.querySelector("input,select,textarea") && !/^(INPUT|SELECT|TEXTAREA)$/.test(prev.tagName)) {
      const t = (prev.textContent ?? "").trim();
      if (t && t.length < 40) bits.push(t);
    }
    return bits.join(" ");
  }
  function describe(el) {
    return [el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("name"), el.id, el.getAttribute("title"), el.getAttribute("data-testid"), labelText(el)].filter(Boolean).join(" ").toLowerCase();
  }
  function formFields() {
    return [...document.querySelectorAll("input, textarea, select")].filter((el) => {
      const r = el.getBoundingClientRect();
      if (el.closest(`[${PILL_HOST_ATTR}]`) || el.disabled || r.width < 20 || r.height < 12) return false;
      if (el instanceof HTMLInputElement) return !SKIP_INPUT_TYPES.has(el.type) && !el.readOnly;
      if (el instanceof HTMLTextAreaElement) return !el.readOnly;
      return true;
    }).map((el) => ({ el, d: describe(el) }));
  }
  function setValue(el, value) {
    if (el instanceof HTMLSelectElement) {
      const want = value.trim();
      const num2 = parseFloat(want);
      const opt = [...el.options].find((o) => {
        const v = o.value.trim();
        const t = (o.textContent ?? "").trim();
        if (v === want || t === want) return true;
        const tn = parseFloat(t.replace(/[^\d.]/g, ""));
        return !Number.isNaN(num2) && !Number.isNaN(tn) && /^\s*\d+(\.\d+)?\s*(\+|yrs?|years?)?\s*$/i.test(t) && tn === num2;
      });
      if (!opt) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter ? setter.call(el, opt.value) : el.value = opt.value;
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter ? setter.call(el, value) : el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const EXP$1 = /exp|year|yrs/;
  const NOT_EXP = /salary|ctc|lac|lakh|notice|keyword|skill|location|city|designation/;
  const NOT_KW$1 = /location|city|cities|\bexp|experience|salary|ctc|lac|lakh|notice|company|employer|institute|college|designation|education|qualification|\bage\b/;
  const ALL_KEYS = ["boolean", "keywords", "anyKeywords", "excludeKeywords", "designation", "minExp", "maxExp", "location", "minSalary", "maxSalary", "notice", "education"];
  const TOGGLE_SEL = "input[type=checkbox],input[type=radio],[role=switch],[role=checkbox],[role=radio],[role=tab],[role=option],button,label";
  function labelOf(el) {
    if (el instanceof HTMLInputElement) {
      const bits = [el.getAttribute("aria-label") ?? ""];
      if (el.id) document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => bits.push(l.textContent ?? ""));
      const wrap = el.closest("label");
      if (wrap) bits.push(wrap.textContent ?? "");
      bits.push(el.nextElementSibling?.textContent ?? el.nextSibling?.textContent ?? "");
      return txt(bits.find((b) => txt(b)) ?? el.value);
    }
    return txt(el.getAttribute("aria-label")) || txt(el.textContent);
  }
  function isOn(el) {
    if (el instanceof HTMLInputElement) return el.checked;
    for (const a of ["aria-checked", "aria-pressed", "aria-selected"]) if (el.getAttribute(a) === "true") return true;
    return /\b(active|selected|checked|is-on|toggled)\b/i.test(el.getAttribute("class") ?? "");
  }
  function controlOf(el) {
    if (el instanceof HTMLLabelElement) {
      const c = el.control ?? el.querySelector("input");
      if (c) return c;
    }
    return el;
  }
  function findToggle(re, maxLen = 60) {
    for (const el of document.querySelectorAll(TOGGLE_SEL)) {
      if (el.closest(`[${PILL_HOST_ATTR}]`)) continue;
      const t = labelOf(el);
      if (t && t.length <= maxLen && re.test(t)) {
        const c = controlOf(el);
        const r = c.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 || el.getBoundingClientRect().width > 0) return c;
      }
    }
    return null;
  }
  async function ensureOn(el) {
    if (!isOn(el)) {
      el.click();
      await sleep(250);
    }
    return isOn(el) || el.getAttribute("role") === "tab";
  }
  function daysOf(text) {
    const t = text.toLowerCase();
    if (/immediate|serving|available now|\b0\s*day/.test(t)) return 0;
    const m = t.match(/(\d+(?:\.\d+)?)\s*(day|week|month)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Math.round(m[2] === "day" ? n : m[2] === "week" ? n * 7 : n * 30);
  }
  async function fillNotice(maxDays) {
    const sel = formFields().find(({ el, d }) => el instanceof HTMLSelectElement && /notice/.test(d));
    if (sel && sel.el instanceof HTMLSelectElement) {
      const opts = [...sel.el.options].map((o) => ({ o, d: daysOf(o.textContent ?? "") })).filter((x) => x.d !== null && x.d <= maxDays);
      const best = opts.sort((a, b) => b.d - a.d)[0];
      if (best && setValue(sel.el, txt(best.o.textContent))) return { status: "filled", detail: txt(best.o.textContent) };
      return { status: "manual", detail: `No option ≤ ${maxDays} days in the dropdown` };
    }
    const heading = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,summary,label,span,div,p")].find(
      (h) => !h.closest(`[${PILL_HOST_ATTR}]`) && h.children.length === 0 && /^notice( period)?\b/i.test(txt(h.textContent)) && txt(h.textContent).length <= 40
    );
    if (!heading) return { status: "missing" };
    let scope = heading.parentElement;
    let inputs = [];
    for (let i = 0; scope && i < 4; i++, scope = scope.parentElement) {
      inputs = [...scope.querySelectorAll("input[type=checkbox],input[type=radio]")];
      if (inputs.length) break;
    }
    const options = inputs.map((el) => ({ el, d: daysOf(labelOf(el)) })).filter((x) => x.d !== null && x.d <= maxDays);
    if (!options.length) return { status: "manual", detail: `No notice option ≤ ${maxDays} days found` };
    const radio = options[0].el.type === "radio";
    const chosen = radio ? [options.sort((a, b) => b.d - a.d)[0]] : options;
    for (const { el } of chosen) if (!el.checked) {
      el.click();
      await sleep(120);
    }
    return { status: "filled", detail: chosen.map((c) => labelOf(c.el)).join(", ") };
  }
  async function fillSearchFields(input) {
    const f = {
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
      useBoolean: input.useBoolean ?? true
    };
    const rep = { ok: false, filled: Object.fromEntries(ALL_KEYS.map((k) => [k, false])), fields: [], notes: [] };
    const done = (key, label, status, detail) => {
      rep.fields.push({ key, label, status, detail });
      if (status === "filled") rep.filled[key] = true;
    };
    let booleanOn = false;
    if (f.booleanQuery.trim() && f.useBoolean) {
      const sw = findToggle(/boolean/i);
      if (sw) {
        booleanOn = await ensureOn(sw);
        done("boolean", "Boolean mode", booleanOn ? "filled" : "manual", booleanOn ? "switched on" : "couldn't confirm the switch is on");
      } else done("boolean", "Boolean mode", "missing", "no Boolean switch on this page — the query still goes in the keyword box");
    }
    const fields = formFields();
    const used = /* @__PURE__ */ new Set();
    const pick = (test, avoid) => {
      const hit = fields.find(({ el, d }) => !used.has(el) && test(d, el) && !(avoid && avoid.test(d)));
      if (hit) used.add(hit.el);
      return hit?.el ?? null;
    };
    const text = (el) => !(el instanceof HTMLSelectElement);
    const range = (kind, avoid) => {
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
      const neighbour = (from, dir) => {
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
      return [min, max];
    };
    const put = (key, label, el, value, unit = "") => {
      if (value === null || value === "") return;
      if (el && setValue(el, String(value))) done(key, label, "filled", `${value}${unit}`);
      else done(key, label, el ? "manual" : "missing", el ? "dropdown has no matching option" : "field not found");
    };
    const [expMin, expMax] = range(EXP$1, NOT_EXP);
    put("minExp", "Min experience", expMin, f.minExp, " yrs");
    put("maxExp", "Max experience", expMax, f.maxExp, " yrs");
    if (f.minSalary !== null || f.maxSalary !== null) {
      const [salMin, salMax] = range(/salary|ctc|lac|lakh|lpa/, /notice|keyword|skill|location|city|designation|experience/);
      put("minSalary", "Min salary", salMin, f.minSalary, " LPA");
      put("maxSalary", "Max salary", salMax, f.maxSalary, " LPA");
    }
    if (f.locations.length) {
      const locEl = pick((d, el) => /current\s*location|location|city|cities/.test(d) && !(el instanceof HTMLSelectElement && el.options.length > 60), /keyword|skill|designation|preferred|relocat/) ?? pick((d) => /preferred\s*location|location|city/.test(d), /keyword|skill|designation/);
      if (locEl && setValue(locEl, f.locations[0])) {
        done("location", "Location", f.locations.length > 1 ? "manual" : "filled", `typed "${f.locations[0]}"`);
        rep.filled.location = true;
        if (f.locations.length > 1) rep.notes.push(`Location: typed "${f.locations[0]}" — add ${f.locations.slice(1).join(", ")} from the Resdex suggestions.`);
      } else done("location", "Location", "missing", f.locations.join(", "));
    }
    if (f.designations.length) {
      const el = pick((d) => /designation|job\s*title|current\s*role|\brole\b/.test(d), /keyword|skill|location|city|employer|company|exp|salary|notice/);
      if (el && setValue(el, f.designations[0])) {
        done("designation", "Designation", f.designations.length > 1 ? "manual" : "filled", `typed "${f.designations[0]}"`);
        rep.filled.designation = true;
        if (f.designations.length > 1) rep.notes.push(`Designation: typed "${f.designations[0]}" — also consider ${f.designations.slice(1).join(", ")}.`);
      } else done("designation", "Designation", "missing", f.designations.join(", "));
    }
    const kwAll = pick((d, el) => text(el) && /(all|must|mandatory)\b[^a-z]*(of )?(these )?keyword|all keywords|must have/.test(d), NOT_KW$1);
    const kwAny = pick((d, el) => text(el) && /(any|optional|at least)\b[^a-z]*(of )?(these )?keyword|any keywords|good to have/.test(d), NOT_KW$1);
    const kwExc = pick((d, el) => text(el) && /exclude|not these|without/.test(d), /location|city|company|employer/);
    const kwGeneric = () => pick((d, el) => text(el) && /keyword|boolean|skill|search/.test(d), NOT_KW$1) ?? pick((d, el) => el instanceof HTMLInputElement && el.type === "search", /location|city/);
    const q = f.booleanQuery.trim();
    const useBooleanBox = !!q && (booleanOn || !kwAll && !kwAny);
    if (useBooleanBox) {
      const el = kwAll ?? kwGeneric();
      if (el && setValue(el, q)) done("keywords", "Boolean query", "filled", q.length > 70 ? `${q.slice(0, 67)}…` : q);
      else done("keywords", "Boolean query", "missing", "keyword box not found — paste the query manually");
    } else {
      const list = (xs) => xs.join(", ");
      if (f.allKeywords.length) put("keywords", "All keywords", kwAll ?? kwGeneric(), list(f.allKeywords));
      if (f.anyKeywords.length) put("anyKeywords", "Any keywords", kwAny, list(f.anyKeywords));
      if (f.excludeKeywords.length) put("excludeKeywords", "Exclude keywords", kwExc, list(f.excludeKeywords));
    }
    if (useBooleanBox && f.excludeKeywords.length && kwExc && !booleanOn) put("excludeKeywords", "Exclude keywords", kwExc, f.excludeKeywords.join(", "));
    if (f.maxNoticeDays !== null) {
      const n = await fillNotice(f.maxNoticeDays);
      done("notice", "Notice period", n.status, n.detail ?? `≤ ${f.maxNoticeDays} days`);
    }
    if (f.education.trim()) {
      const el = pick((d, el2) => text(el2) && /education|qualification|degree|course/.test(d), /keyword|skill|location|city|employer|company|institute|college/);
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
  function mapForm() {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && !el.closest(`[${PILL_HOST_ATTR}]`);
    };
    const controls = [...document.querySelectorAll("input,select,textarea")].filter(vis).slice(0, 150).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type ?? "",
      descriptor: describe(el).slice(0, 160),
      options: el instanceof HTMLSelectElement ? [...el.options].slice(0, 12).map((o) => txt(o.textContent)) : void 0,
      checked: el instanceof HTMLInputElement && /checkbox|radio/.test(el.type) ? el.checked : void 0,
      label: el instanceof HTMLInputElement && /checkbox|radio/.test(el.type) ? labelOf(el).slice(0, 60) : void 0
    }));
    const toggles = [...document.querySelectorAll("[role=switch],[role=tab],[role=checkbox],button[aria-pressed]")].filter(vis).slice(0, 60).map((el) => ({ role: el.getAttribute("role") ?? el.tagName.toLowerCase(), text: txt(el.textContent).slice(0, 50), on: isOn(el) }));
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,legend")].filter(vis).slice(0, 40).map((h) => txt(h.textContent).slice(0, 50));
    return { url: location.origin + location.pathname, controls, toggles, headings };
  }
  function normalizePhone(raw) {
    if (!raw) return "";
    const intl = /^\s*\+/.test(raw);
    let d = raw.replace(/\D/g, "");
    if (!d) return "";
    if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
    else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
    if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
    if (intl && d.length >= 8 && d.length <= 15) return `+${d}`;
    return "";
  }
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  const IN_MOBILE = /(?<![\d])(?:\(?\+?\s*91\)?[\s\-.]*|0[\s\-.]*)?([6-9](?:[\s\-.]?\d){9})(?![\d])/g;
  const INTL = /(?<![\d\w])\+(?!91\b)\d{1,3}[\s\-.]?(?:\(?\d{1,4}\)?[\s\-.]?){2,4}\d{2,4}(?![\d])/g;
  const MASKED = /(?<![\d])[6-9]\d?[xX*•●]{3,}\d{0,3}(?![\d])|\b(?:xxxx+|\*{4,})\b/;
  function extractContacts(text) {
    const t = text ?? "";
    const emails = [...new Set((t.match(EMAIL) ?? []).filter((e) => !/\*|xxx/i.test(e)).map((e) => e.toLowerCase()))];
    const phones = [];
    for (const m of t.matchAll(IN_MOBILE)) {
      const p = normalizePhone(m[0]);
      if (p && !phones.includes(p)) phones.push(p);
    }
    for (const m of t.matchAll(INTL)) {
      const p = normalizePhone(m[0]);
      if (p && !phones.includes(p)) phones.push(p);
    }
    return { emails, phones, phoneMasked: phones.length === 0 && MASKED.test(t) };
  }
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  function resultMatchesCard(extracted, rawText) {
    if (!extracted) return true;
    const text = ` ${norm(rawText)} `;
    const name = norm(extracted.fullName);
    if (!name) return true;
    const parts = name.split(" ").filter((w) => w.length >= 2);
    if (!parts.length) return true;
    const hit = parts.filter((w) => text.includes(` ${w} `) || text.includes(` ${w}`)).length;
    if (hit / parts.length < 0.6) return false;
    const company = norm(extracted.currentCompany);
    if (company.length >= 4) {
      const words = company.split(" ").filter((w) => w.length >= 3);
      if (words.length && !words.some((w) => text.includes(w))) return false;
    }
    return true;
  }
  const EXP = /exp|year|yrs/;
  const SAL = /salary|ctc|lac|lakh|lpa/;
  const LOC = /location|city|cities/;
  const KW = /keyword|boolean|skill|designation|role|search/;
  const NOT_KW = /location|city|cities|\bexp|experience|salary|ctc|lac|lakh|lpa|notice|company|employer|institute|college|age\b|gender/;
  const CHIP_SEL = '[class*="chip" i],[class*="tag" i],[class*="token" i],[class*="pill" i],[class*="badge" i],[class*="selected-item" i],[class*="multi-value" i]';
  const NOISE_PARAM = /^(utm_|_ga|fbclid|gclid|token|ts$|timestamp|_$|sid$|cb$)/i;
  const PAGE_PARAM = /^(page|pageno|pagenumber|pg|start|offset|p)$/i;
  const clean = (s) => (s ?? "").replace(/\s+/g, " ").replace(/[×✕✖]/g, "").trim();
  const num = (s) => {
    const m = clean(s).match(/-?\d+(?:\.\d+)?/);
    const n = m ? parseFloat(m[0]) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  function valueOf(el) {
    if (el instanceof HTMLSelectElement) {
      const o = el.selectedOptions[0];
      if (!o || !o.value.trim() || el.selectedIndex === 0 && /^(any|select|choose|all|none|--)/i.test(clean(o.textContent))) return "";
      return clean(o.textContent);
    }
    return clean(el.value);
  }
  function chipsNear(el) {
    const out = [];
    const visibleField = (x) => {
      const f = x;
      if (f.type === "hidden" || f.hidden) return false;
      const r = f.getBoundingClientRect();
      return r.width > 20 && r.height > 10;
    };
    let scope = el.parentElement;
    for (let depth = 0; scope && depth < 3; depth++, scope = scope.parentElement) {
      if ([...scope.querySelectorAll("input,select,textarea")].some((x) => x !== el && visibleField(x))) break;
      const found = [...scope.querySelectorAll(CHIP_SEL)].filter((c) => !c.querySelector("input,select,textarea") && !c.closest(`[${PILL_HOST_ATTR}]`) && !c.querySelector(CHIP_SEL));
      for (const c of found) {
        const t = clean(c.textContent);
        if (t.length >= 1 && t.length <= 60 && !/^(x|close|clear|remove|add)$/i.test(t)) out.push(t);
      }
      if (out.length) break;
    }
    return [...new Set(out)];
  }
  function rangeOf(fields, kind, notKind) {
    const mine = fields.filter(({ d }) => kind.test(d) && !notKind.test(d));
    if (!mine.length) return [null, null];
    const min = mine.find(({ d }) => /\bmin|from|minimum|\blow/.test(d));
    const max = mine.find(({ d }) => /\bmax|\bto\b|maximum|\bhigh/.test(d));
    if (min || max) return [min ? num(valueOf(min.el)) : null, max ? num(valueOf(max.el)) : null];
    if (mine.length === 2) return [num(valueOf(mine[0].el)), num(valueOf(mine[1].el))];
    if (mine.length === 1) return [num(valueOf(mine[0].el)), null];
    return [null, null];
  }
  const isHeadingEl = (c) => (/^(H[1-6]|LEGEND|SUMMARY)$/.test(c.tagName) || /title|heading|header|label|name/i.test(c.getAttribute("class") ?? "") && !c.querySelector("input,select,textarea")) && clean(c.textContent).length > 0 && clean(c.textContent).length <= 40;
  function groupLabel(el) {
    let a = el.parentElement;
    for (let i = 0; a && i < 6; i++, a = a.parentElement) {
      const h = [...a.children].find((c) => !c.contains(el) && isHeadingEl(c));
      if (h) return clean(h.textContent);
    }
    return "";
  }
  function insideCard(el) {
    let a = el.parentElement;
    for (let i = 0; a && i < 8; i++, a = a.parentElement) {
      if (/^(BODY|HTML|MAIN|ASIDE|NAV|HEADER|FORM)$/.test(a.tagName)) return false;
      if (a.querySelector("input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea")) return false;
      if (a.querySelectorAll("input[type=checkbox],input[type=radio],[role=checkbox]").length > 2) return false;
      const t = a.innerText ?? "";
      if (t.length > 250 && t.length < 6e3 && /\b\d{1,2}(?:\.\d)?\s*\+?\s*(yrs?|years?)\b/i.test(t) && /notice|lacs?|lpa|₹/i.test(t)) return true;
    }
    return false;
  }
  function optionLabel(el) {
    const bits = [];
    if (el.id) document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => bits.push(l.textContent ?? ""));
    const wrap = el.closest("label");
    if (wrap) bits.push(wrap.textContent ?? "");
    bits.push(el.nextElementSibling?.textContent ?? el.nextSibling?.textContent ?? "");
    return bits.map(clean).find(Boolean) || clean(el.getAttribute("aria-label")) || clean(el.value);
  }
  function readFilters(skip) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const push = (label, value) => {
      const v = clean(value);
      if (!v || v.length > 120 || /^(select|choose|apply|reset|clear|search|more|less|show|hide)\b/i.test(v) || /select (all|candidate)|compare|bulk/i.test(v)) return;
      const k = `${label.toLowerCase()}|${v.toLowerCase()}`;
      if (seen.has(k) || out.length >= 80) return;
      seen.add(k);
      out.push({ label: clean(label).slice(0, 100), value: v.slice(0, 280) });
    };
    document.querySelectorAll("input[type=checkbox]:checked, input[type=radio]:checked").forEach((el) => {
      if (skip.has(el) || el.closest(`[${PILL_HOST_ATTR}]`) || insideCard(el)) return;
      push(groupLabel(el), optionLabel(el));
    });
    document.querySelectorAll('[aria-checked="true"],[aria-pressed="true"],[aria-selected="true"]').forEach((el) => {
      if (el instanceof HTMLInputElement || skip.has(el) || el.closest(`[${PILL_HOST_ATTR}]`) || el.getAttribute("role") === "tab" || insideCard(el)) return;
      const t = clean(el.getAttribute("aria-label")) || clean(el.textContent);
      if (t && t.length <= 60) push(groupLabel(el), t);
    });
    document.querySelectorAll("select").forEach((el) => {
      if (skip.has(el) || el.closest(`[${PILL_HOST_ATTR}]`)) return;
      const v = valueOf(el);
      if (v) push(clean(describe(el)).slice(0, 60) || groupLabel(el), v);
    });
    return out;
  }
  function urlFilters() {
    const out = [];
    const add = (qs) => {
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
  function readPage() {
    const sp = new URLSearchParams(location.search);
    for (const k of sp.keys()) if (PAGE_PARAM.test(k)) return num(sp.get(k));
    const cur = document.querySelector('[aria-current="page"]');
    return cur ? num(cur.textContent) : null;
  }
  function readSearchState() {
    const fields = formFields();
    const used = /* @__PURE__ */ new Set();
    const use = (xs) => xs.forEach((x) => used.add(x.el));
    const expF = fields.filter(({ d }) => EXP.test(d) && !SAL.test(d) && !/notice|keyword|skill|location|city/.test(d));
    const [minExp, maxExp] = rangeOf(fields, EXP, /salary|ctc|lac|lakh|notice|keyword|skill|location|city/);
    use(expF);
    const salF = fields.filter(({ d }) => SAL.test(d));
    const [minSalary, maxSalary] = rangeOf(fields, SAL, /notice|keyword|skill|location|city/);
    use(salF);
    const locF = fields.filter(({ el, d }) => LOC.test(d) && !used.has(el) && !/keyword|skill|designation/.test(d) && !(el instanceof HTMLSelectElement && el.options.length > 60));
    use(locF);
    const loc = [...new Set(locF.flatMap(({ el }) => [...valueOf(el).split(/[,;]/), ...chipsNear(el)]).map(clean).filter(Boolean))];
    const kwF = fields.filter(({ el, d }) => !used.has(el) && !(el instanceof HTMLSelectElement) && KW.test(d) && !NOT_KW.test(d));
    use(kwF);
    const main2 = [];
    const any = [];
    const exclude = [];
    for (const { el, d } of kwF) {
      const parts = [valueOf(el), ...chipsNear(el)].map(clean).filter(Boolean);
      (/exclude|\bnot\b|without/.test(d) ? exclude : /\bany\b|at least one|\bor\b/.test(d) ? any : main2).push(...parts);
    }
    const filters = [...readFilters(used), ...urlFilters()];
    return {
      keywords: [...new Set(main2)].join(" "),
      anyKeywords: [...new Set(any)],
      excludeKeywords: [...new Set(exclude)],
      location: loc.join(", "),
      minExp,
      maxExp,
      minSalary,
      maxSalary,
      filters,
      url: location.origin + location.pathname,
      page: readPage()
    };
  }
  function searchSignature(s, hash) {
    const n = (x) => x.toLowerCase().replace(/\s+/g, " ").trim();
    const sorted = (a) => a.map(n).filter(Boolean).sort();
    return hash(
      JSON.stringify({
        k: n(s.keywords),
        a: sorted(s.anyKeywords),
        x: sorted(s.excludeKeywords),
        l: sorted(s.location.split(",")),
        e: [s.minExp, s.maxExp],
        s: [s.minSalary, s.maxSalary],
        f: sorted(s.filters.map((f) => `${n(f.label)}=${n(f.value)}`))
      })
    );
  }
  const CONTENT_VERSION = 4;
  if (!window.__resdexCopilot) {
    window.__resdexCopilot = true;
    main();
  }
  function main() {
    const CARD_MAX_CHARS = 2500;
    const PROFILE_MAX_CHARS = 9e3;
    const DEBOUNCE_MS = 800;
    const RETRY_AFTER_MS = 15e3;
    const EXP_RE = /\b\d{1,2}(?:\.\d)?\s*\+?\s*(?:yrs?|years?)\b/i;
    const SAL_RE = /(?:\blacs?\b|\blakhs?\b|\blpa\b|\bcr\b|₹|\brs\.?\s?\d)/i;
    const SIGNALS = [
      /notice/i,
      /current|present|designation/i,
      /key\s*skills?|skills?|preferred|expertise/i,
      /bangalore|bengaluru|mumbai|delhi|ncr|gurgaon|gurugram|noida|pune|hyderabad|chennai|kolkata|ahmedabad|remote|india/i,
      /b\.?\s?tech|m\.?\s?tech|\bb\.?e\b|mba|mca|bca|b\.?\s?sc|m\.?\s?sc|graduat|diploma/i
    ];
    const PROFILE_URL_RE = /(profile|viewcv|cvview|candidate|resume|\bcv\b)/i;
    let seq = 0;
    let blocked = null;
    let running = false;
    let rerun = false;
    let debounceTimer;
    const entries = /* @__PURE__ */ new Map();
    const cache = /* @__PURE__ */ new Map();
    const failedAt = /* @__PURE__ */ new Map();
    let lastProfileSig = "";
    let settings = { ...DEFAULT_SETTINGS };
    const scoringAllowed = () => settings.scoring && !settings.analyzedOnly;
    let forceScore = false;
    let applied = null;
    let prevCardHashes = /* @__PURE__ */ new Set();
    let lastLiveSig = "";
    let lastUrl = location.href;
    let searchTimer;
    function send(msg) {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(msg, (r) => {
            if (chrome.runtime.lastError || !r) resolve({ ok: false, error: chrome.runtime.lastError?.message ?? "No response" });
            else resolve(r);
          });
        } catch {
          resolve({ ok: false, error: "Extension context invalidated — reload the page" });
        }
      });
    }
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === "PING") {
        sendResponse({ ok: true, v: CONTENT_VERSION });
      } else if (msg.type === "FILL_RESDEX_SEARCH") {
        const legacy = msg.keywords;
        const fields = msg.fields ?? (legacy ? { booleanQuery: legacy, minExp: null, maxExp: null, locations: [] } : void 0);
        if (!fields) {
          sendResponse({ ok: false, error: "No search values received — reload the extension and try again.", filled: {}, fields: [], notes: [] });
          return false;
        }
        void fillSearchFields(fields).then(sendResponse);
        return true;
      } else if (msg.type === "MAP_FORM") {
        sendResponse(mapForm());
      } else if (msg.type === "READ_PROFILE") {
        sendResponse(readProfile());
      } else if (msg.type === "FETCH_CV") {
        void fetchCv(msg.href).then(sendResponse);
        return true;
      } else if (msg.type === "FOCUS_CARD") {
        sendResponse({ ok: focusCard(msg.domId) });
      } else if (msg.type === "URL_CHANGED") {
        onUrlChange();
        sendResponse({ ok: true });
      } else if (msg.type === "READ_SEARCH") {
        publishSearch(true);
        sendResponse({ ok: true });
      } else if (msg.type === "SCORE_PENDING") {
        forceScore = true;
        schedule(0);
        sendResponse({ ok: true });
      }
      return false;
    });
    chrome.storage.local.get(K.settings).then((o) => {
      settings = { ...DEFAULT_SETTINGS, ...o[K.settings] ?? {} };
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[K.settings]) {
        const was = scoringAllowed();
        settings = { ...DEFAULT_SETTINGS, ...changes[K.settings].newValue ?? {} };
        if (was !== scoringAllowed()) {
          if (!scoringAllowed()) forceScore = false;
          schedule(0);
        }
      }
      const idSig = (v) => {
        const j = v;
        return `${j?.id ?? ""}|${j?.sig ?? ""}`;
      };
      const jobChanged = changes.activeJob && idSig(changes.activeJob.oldValue) !== idSig(changes.activeJob.newValue);
      if (jobChanged || changes.config) {
        resetAll();
        schedule(0);
        if (changes.config) {
          lastLiveSig = "";
          lastAppliedSig = "";
          scheduleSearchRead(300);
        }
      }
    });
    function cleanText(el, max) {
      const raw = el.innerText || "";
      return raw.replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, max);
    }
    function hashStr(s) {
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) | 0;
      return (h >>> 0).toString(36);
    }
    function labelOf2(text) {
      const line = text.split("\n").map((l) => l.trim()).find((l) => l.length >= 3 && l.length <= 60 && /[a-z]/i.test(l) && !EXP_RE.test(l) && !SAL_RE.test(l));
      return line ?? "Candidate";
    }
    function cardLink(el) {
      for (const a of el.querySelectorAll("a[href]")) {
        if (a.closest(`[${PILL_HOST_ATTR}]`)) continue;
        try {
          const u = new URL(a.href, location.href);
          if (u.origin === location.origin && PROFILE_URL_RE.test(u.pathname + u.search)) return u.href;
        } catch {
        }
      }
      return void 0;
    }
    function visible(el) {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 20;
    }
    function looksLikeCard(el) {
      const t = el.innerText;
      if (!t || t.length < 250 || t.length > 6e3) return false;
      if (!EXP_RE.test(t)) return false;
      if (!SAL_RE.test(t) && !/notice/i.test(t)) return false;
      let n = 0;
      for (const s of SIGNALS) if (s.test(t)) n++;
      return n >= 2;
    }
    function findCards() {
      if (!document.body) return [];
      const minimal = /* @__PURE__ */ new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          const p = n.parentElement;
          if (!p || p.closest(`script,style,noscript,[${PILL_HOST_ATTR}]`)) return NodeFilter.FILTER_REJECT;
          return EXP_RE.test(n.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      });
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        let el = n.parentElement;
        for (let depth = 0; el && el !== document.body && depth < 14; depth++, el = el.parentElement) {
          if (looksLikeCard(el)) {
            minimal.add(el);
            break;
          }
        }
      }
      const arr = [...minimal];
      const outer = arr.filter((a) => !arr.some((b) => b !== a && b.contains(a)));
      const set = new Set(outer);
      const grown = /* @__PURE__ */ new Set();
      for (const m of outer) {
        let cur = m;
        for (let i = 0; i < 4; i++) {
          const p = cur.parentElement;
          if (!p || p === document.body) break;
          let count = 0;
          for (const o of set) if (p.contains(o)) count++;
          if (count !== 1 || (p.innerText?.length ?? 0) > 6e3) break;
          cur = p;
        }
        if (visible(cur)) grown.add(cur);
      }
      return [...grown];
    }
    function detectProfile(cardCount) {
      const dlg = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].find(
        (d) => visible(d) && (d.innerText?.length ?? 0) > 500 && EXP_RE.test(d.innerText)
      );
      let source = dlg ?? null;
      if (!source && PROFILE_URL_RE.test(location.pathname + location.hash) && cardCount <= 1) {
        source = document.querySelector("main") ?? document.body;
      }
      if (!source) return null;
      const rawText = cleanText(source, PROFILE_MAX_CHARS);
      if (rawText.length < 300 || !EXP_RE.test(rawText)) return null;
      return { url: location.href, rawText, label: labelOf2(rawText) };
    }
    const CV_LINK_RE = /(download|view|get)[^a-z]{0,6}(cv|resume|résumé)|\b(cv|resume)\b[^a-z]{0,6}download|\.(pdf|docx?)(\?|#|$)/i;
    function readProfile() {
      const prof = detectProfile(findCards().length);
      if (!prof) return { open: false, url: location.href, rawText: "", phones: [], emails: [], phoneMasked: false, cvLinks: [] };
      const c = extractContacts(prof.rawText);
      const dlg = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].find((d) => visible(d) && EXP_RE.test(d.innerText));
      const scope = dlg ?? document.querySelector("main") ?? document.body;
      const seen = /* @__PURE__ */ new Set();
      const cvLinks = [];
      for (const a of scope.querySelectorAll("a[href]")) {
        if (a.closest(`[${PILL_HOST_ATTR}]`)) continue;
        const label = (a.innerText || a.getAttribute("aria-label") || a.title || "").replace(/\s+/g, " ").trim();
        try {
          const u = new URL(a.href, location.href);
          if (!/(^|\.)naukri\.com$/i.test(u.hostname) || seen.has(u.href)) continue;
          if (CV_LINK_RE.test(label) || CV_LINK_RE.test(u.pathname + u.search)) {
            seen.add(u.href);
            cvLinks.push({ href: u.href, label: label.slice(0, 60) || "CV" });
          }
        } catch {
        }
      }
      return { open: true, url: prof.url, rawText: prof.rawText, phones: c.phones, emails: c.emails, phoneMasked: c.phoneMasked, cvLinks: cvLinks.slice(0, 4) };
    }
    async function fetchCv(href) {
      try {
        const u = new URL(href, location.href);
        if (!/(^|\.)naukri\.com$/i.test(u.hostname) || u.protocol !== "https:") return { ok: false, error: "Only naukri.com CV links can be fetched" };
        const res = await fetch(u.href, { credentials: "include" });
        if (!res.ok) return { ok: false, error: `Resdex answered ${res.status} — the CV may need a download credit or the link expired` };
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 4 * 1024 * 1024) return { ok: false, error: "CV is larger than 4 MB" };
        const head = new Uint8Array(buf.slice(0, 4));
        const isPdf = head[0] === 37 && head[1] === 80 && head[2] === 68 && head[3] === 70;
        const isZip = head[0] === 80 && head[1] === 75;
        if (!isPdf && !isZip) return { ok: false, error: "That link did not return a PDF or DOCX file" };
        const cd = res.headers.get("content-disposition") ?? "";
        const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1];
        const name = decodeURIComponent(fromHeader ?? u.pathname.split("/").pop() ?? "cv").replace(/[^\w.\- ]+/g, "_");
        const ext = isPdf ? ".pdf" : ".docx";
        let bin = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return { ok: true, name: /\.(pdf|docx)$/i.test(name) ? name : `${name}${ext}`, mime: isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", base64: btoa(bin) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    const PILL_CSS = `
    :host{all:initial;position:absolute;top:8px;right:8px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
    button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;line-height:1.2;color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);white-space:nowrap}
    button:hover{filter:brightness(1.08)}
    .open{background:#059669}.review{background:#d97706}.skip{background:#64748b}.pending{background:#64748b}.err{background:#475569}.unscored{background:#fff;color:#475569;box-shadow:0 0 0 1.5px #94a3b8 inset}
    .tier{font-weight:600;opacity:.95;padding-left:6px;border-left:1px solid rgba(255,255,255,.55)}
    .dot{width:6px;height:6px;border-radius:50%;background:#fff;opacity:.9}
    .pending .dot{animation:p 1s infinite}@keyframes p{50%{opacity:.2}}
  `;
    function renderPill(entry) {
      let host = entry.el.querySelector(`:scope > [${PILL_HOST_ATTR}]`);
      if (host && !host._btn) {
        host.remove();
        host = null;
      }
      if (!host) {
        host = document.createElement("div");
        host.setAttribute(PILL_HOST_ATTR, "true");
        const root = host.attachShadow({ mode: "closed" });
        const style = document.createElement("style");
        style.textContent = PILL_CSS;
        const btn2 = document.createElement("button");
        btn2.type = "button";
        btn2.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void send({ type: "CARD_CLICKED", domId: entry.domId });
        });
        root.append(style, btn2);
        host._btn = btn2;
        if (getComputedStyle(entry.el).position === "static") entry.el.style.position = "relative";
        entry.el.appendChild(host);
      }
      const btn = host._btn;
      const r = entry.result;
      if (entry.state === "done" && r) {
        const w = worthOf(r);
        btn.className = w;
        btn.replaceChildren(document.createTextNode(`${r.score}%`));
        const tier = document.createElement("span");
        tier.className = "tier";
        tier.textContent = w === "open" ? `★ ${WORTH_LABEL.open.short}` : WORTH_LABEL[w].short;
        btn.append(tier);
        const why = r.worthReasons?.length ? `
${r.worthReasons.join(" · ")}` : "";
        btn.title = `${WORTH_LABEL[w].long}
${r.oneLineVerdict}${why}${r.cached ? "\n(already analyzed — from cache, no AI call)" : ""}`;
      } else if (entry.state === "unscored") {
        btn.className = "unscored";
        btn.replaceChildren(document.createTextNode(settings.scoring ? "Not analyzed" : "Stopped"));
        btn.title = "Scoring is stopped (or Analyzed-only is on): this candidate is not analyzed yet, so no AI call was made. Press START in the side panel to score it.";
      } else if (entry.state === "pending") {
        btn.className = "pending";
        btn.replaceChildren();
        const dot = document.createElement("span");
        dot.className = "dot";
        btn.append(dot, document.createTextNode("Scoring…"));
        btn.title = "Scoring with AI";
      } else {
        btn.className = "err";
        btn.textContent = "AI: retry";
        btn.title = entry.error ?? "Scoring failed";
      }
    }
    function removePills() {
      document.querySelectorAll(`[${PILL_HOST_ATTR}]`).forEach((n) => n.remove());
    }
    function resetAll() {
      blocked = null;
      cache.clear();
      failedAt.clear();
      entries.clear();
      lastProfileSig = "";
      prevCardHashes = /* @__PURE__ */ new Set();
      removePills();
      document.querySelectorAll("[data-ai-scored]").forEach((el) => {
        delete el.dataset.aiScored;
        delete el.dataset.aiHash;
      });
    }
    function schedule(ms = DEBOUNCE_MS) {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(scan, ms);
    }
    function publish() {
      const list = [...entries.values()].map(({ domId, label, rawText, state, result, error, profileUrl }) => ({ domId, label, rawText, state, result, error, profileUrl }));
      void send({ type: "PUBLISH_RANKING", entries: list });
    }
    async function scan() {
      if (running) {
        rerun = true;
        return;
      }
      running = true;
      const scanForce = forceScore;
      forceScore = false;
      const allowed = scoringAllowed() || scanForce;
      try {
        const cards = findCards();
        let changed = false;
        for (const [id, e] of entries) {
          if (!e.el.isConnected || !cards.includes(e.el)) {
            entries.delete(id);
            changed = true;
          }
        }
        const todo = [];
        const curHashes = /* @__PURE__ */ new Set();
        for (const el of cards) {
          const domId = el.dataset.aiId ??= `ai-${++seq}`;
          const rawText = cleanText(el, CARD_MAX_CHARS);
          const h = hashStr(rawText);
          curHashes.add(h);
          const known = entries.get(domId);
          if (el.dataset.aiScored === "true" && el.dataset.aiHash === h && known && !(known.state === "unscored" && allowed)) {
            if (!el.querySelector(`:scope > [${PILL_HOST_ATTR}]`)) renderPill(known);
            continue;
          }
          const entry = { domId, label: labelOf2(rawText), rawText, state: "pending", hash: h, el, profileUrl: cardLink(el) };
          const hit = cache.get(h);
          if (hit) {
            const e2 = { ...entry, state: "done", result: { ...hit, domId } };
            entries.set(domId, e2);
            el.dataset.aiScored = "true";
            el.dataset.aiHash = h;
            renderPill(e2);
            changed = true;
            continue;
          }
          const lastFail = failedAt.get(h);
          if (lastFail && Date.now() - lastFail < RETRY_AFTER_MS) {
            if (known && known.hash !== h) {
              entries.delete(domId);
              el.querySelector(`:scope > [${PILL_HOST_ATTR}]`)?.remove();
              changed = true;
            }
            continue;
          }
          el.dataset.aiHash = h;
          entries.set(domId, entry);
          todo.push(entry);
          changed = true;
        }
        noteResultSet(curHashes);
        let blockedNow = false;
        let stoppedMidway = false;
        if (!blocked && todo.length) {
          todo.forEach(renderPill);
          publish();
          for (let i = 0; i < todo.length; i += 20) {
            const chunk = todo.slice(i, i + 20);
            if (allowed && !(scoringAllowed() || scanForce)) {
              stoppedMidway = true;
              for (const c of todo.slice(i)) {
                const e = entries.get(c.domId);
                if (!e) continue;
                e.state = "unscored";
                e.result = void 0;
                delete c.el.dataset.aiScored;
                renderPill(e);
              }
              break;
            }
            const res = await send({
              type: "SCORE_CARDS",
              cards: chunk.map((c) => ({ domId: c.domId, rawText: c.rawText, profileUrl: c.profileUrl })),
              onlyCached: !allowed
            });
            if (!res.ok || !res.data) {
              if (res.code === "NO_JOB" || res.code === "NOT_CONFIGURED") {
                blocked = res.code;
                for (const c of chunk) {
                  entries.delete(c.domId);
                  c.el.querySelector(`:scope > [${PILL_HOST_ATTR}]`)?.remove();
                }
                blockedNow = true;
                break;
              }
              for (const c of chunk) {
                const e = entries.get(c.domId);
                if (!e) continue;
                e.state = "error";
                e.error = res.error;
                failedAt.set(c.hash, Date.now());
                renderPill(e);
              }
              continue;
            }
            const byId = new Map(res.data.results.map((r) => [r.domId, r]));
            const unscoredIds = new Set(res.data.unscored ?? []);
            const mismatched = [];
            for (const c of chunk) {
              const e = entries.get(c.domId);
              if (!e) continue;
              const r = byId.get(c.domId);
              if (!r && unscoredIds.has(c.domId)) {
                e.state = "unscored";
                e.result = void 0;
                c.el.dataset.aiScored = "true";
              } else if (r && !resultMatchesCard(r.extracted, c.rawText)) {
                mismatched.push(c);
                continue;
              } else if (r) {
                e.state = "done";
                e.result = r;
                cache.set(c.hash, r);
                c.el.dataset.aiScored = "true";
              } else {
                e.state = "error";
                e.error = "Model returned no score for this card";
                failedAt.set(c.hash, Date.now());
              }
              renderPill(e);
            }
            for (const c of mismatched) {
              const e = entries.get(c.domId);
              if (!e) continue;
              const one = await send({
                type: "SCORE_CARDS",
                cards: [{ domId: c.domId, rawText: c.rawText, profileUrl: c.profileUrl }],
                onlyCached: false
              });
              const r1 = one.ok ? one.data?.results.find((x) => x.domId === c.domId) : void 0;
              if (r1 && resultMatchesCard(r1.extracted, c.rawText)) {
                e.state = "done";
                e.result = r1;
                cache.set(c.hash, r1);
                c.el.dataset.aiScored = "true";
              } else {
                e.state = "error";
                e.result = void 0;
                e.error = "The AI returned another candidate's details for this card, so it was discarded. Press Start again to retry.";
                failedAt.set(c.hash, Date.now());
              }
              renderPill(e);
            }
            publish();
          }
          changed = blockedNow || stoppedMidway;
        } else if (blocked && todo.length) {
          todo.forEach((c) => entries.delete(c.domId));
          changed = true;
        }
        if (changed) publish();
        const prof = detectProfile(cards.length);
        if (prof && !blocked) {
          const sig = hashStr(prof.url + prof.rawText);
          if (sig !== lastProfileSig) {
            lastProfileSig = sig;
            void send({ type: "PROFILE_DETECTED", ...prof });
          }
        }
      } finally {
        running = false;
        if (rerun) {
          rerun = false;
          schedule();
        }
      }
    }
    function noteResultSet(cur) {
      if (!cur.size) return;
      let same = 0;
      for (const h of cur) if (prevCardHashes.has(h)) same++;
      const isNewSet = prevCardHashes.size === 0 || same / cur.size < 0.5;
      prevCardHashes = cur;
      if (!isNewSet) return;
      const state = readSearchState();
      applied = { state, sig: searchSignature(state, hashStr) };
      publishSearch(true);
    }
    let lastAppliedSig = "";
    function publishSearch(force = false) {
      const live = readSearchState();
      const liveSig = searchSignature(live, hashStr);
      if (!applied) applied = { state: live, sig: liveSig };
      if (!force && liveSig === lastLiveSig && applied.sig === lastAppliedSig) return;
      lastLiveSig = liveSig;
      lastAppliedSig = applied.sig;
      void send({ type: "SEARCH_STATE", snapshot: { live, liveSig, applied: applied.state, appliedSig: applied.sig, ts: Date.now() } });
    }
    function scheduleSearchRead(ms = 400) {
      if (searchTimer) return;
      searchTimer = window.setTimeout(() => {
        searchTimer = void 0;
        publishSearch();
      }, ms);
    }
    function onUrlChange() {
      if (location.href === lastUrl && !document.hidden) {
        scheduleSearchRead(300);
        return;
      }
      lastUrl = location.href;
      lastProfileSig = "";
      scheduleSearchRead(300);
      schedule(250);
    }
    const observer = new MutationObserver((records) => {
      const foreign = records.some((r) => {
        const t = r.target;
        if (t instanceof Element && t.closest(`[${PILL_HOST_ATTR}]`)) return false;
        if (r.type === "childList") {
          const nodes = [...r.addedNodes, ...r.removedNodes];
          if (nodes.length && nodes.every((n) => n instanceof Element && n.hasAttribute(PILL_HOST_ATTR))) return false;
        }
        return true;
      });
      if (foreign) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", onUrlChange);
    window.addEventListener("hashchange", onUrlChange);
    window.navigation?.addEventListener?.("navigatesuccess", onUrlChange);
    window.setInterval(() => {
      if (location.href !== lastUrl) onUrlChange();
    }, 700);
    const ours = (t) => t instanceof Element && !!t.closest(`[${PILL_HOST_ATTR}]`);
    for (const type of ["input", "change", "keyup"]) document.addEventListener(type, (e) => !ours(e.target) && scheduleSearchRead(400), true);
    document.addEventListener(
      "click",
      (e) => {
        if (ours(e.target)) return;
        scheduleSearchRead(350);
        schedule(1200);
      },
      true
    );
    document.addEventListener("keydown", (e) => e.key === "Enter" && !ours(e.target) && (scheduleSearchRead(350), schedule(1200)), true);
    new MutationObserver((records) => {
      if (records.some((r) => !(r.target instanceof Element && r.target.closest(`[${PILL_HOST_ATTR}]`)))) scheduleSearchRead(500);
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["aria-checked", "aria-pressed", "aria-selected", "checked", "class"] });
    schedule(1200);
    scheduleSearchRead(1500);
    function focusCard(domId) {
      const e = entries.get(domId);
      const el = e?.el ?? document.querySelector(`[data-ai-id="${CSS.escape(domId)}"]`);
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const prev = el.style.outline;
      const prevOffset = el.style.outlineOffset;
      el.style.outline = "3px solid #6366f1";
      el.style.outlineOffset = "2px";
      window.setTimeout(() => {
        el.style.outline = prev;
        el.style.outlineOffset = prevOffset;
      }, 2200);
      return true;
    }
  }
})();
