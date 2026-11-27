/**
 * Structural discovery of Resdex candidate cards, shared by the passive observer (score pills) and the sourcing agent (page capture).
 * Cards are found by what they contain ("N yrs", salary / notice / location signals), never by obfuscated CSS class names.
 * READ-ONLY: nothing here clicks, types or opens anything.
 */
import { PILL_HOST_ATTR } from "./formFields";

export const EXP_RE = /\b\d{1,2}(?:\.\d)?\s*\+?\s*(?:yrs?|years?)\b/i;
export const SAL_RE = /(?:\blacs?\b|\blakhs?\b|\blpa\b|\bcr\b|₹|\brs\.?\s?\d)/i;
export const SIGNALS: RegExp[] = [
  /notice/i,
  /current|present|designation/i,
  /key\s*skills?|skills?|preferred|expertise/i,
  /bangalore|bengaluru|mumbai|delhi|ncr|gurgaon|gurugram|noida|pune|hyderabad|chennai|kolkata|ahmedabad|remote|india/i,
  /b\.?\s?tech|m\.?\s?tech|\bb\.?e\b|mba|mca|bca|b\.?\s?sc|m\.?\s?sc|graduat|diploma/i,
];
export const PROFILE_URL_RE = /(profile|viewcv|cvview|candidate|resume|\bcv\b)/i;


/* ───────── text helpers ───────── */
export function cleanText(el: HTMLElement, max: number): string {
  const raw = el.innerText || "";
  return raw
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, max);
}

export function hashStr(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function labelOf(text: string): string {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 3 && l.length <= 60 && /[a-z]/i.test(l) && !EXP_RE.test(l) && !SAL_RE.test(l));
  return line ?? "Candidate";
}

/** Read-only: the card's own profile link (if any). We never click, open or fetch it. */
export function cardLink(el: HTMLElement): string | undefined {
  for (const a of el.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (a.closest(`[${PILL_HOST_ATTR}]`)) continue;
    try {
      const u = new URL(a.href, location.href);
      if (u.origin === location.origin && PROFILE_URL_RE.test(u.pathname + u.search)) return u.href;
    } catch {
      /* ignore malformed href */
    }
  }
  return undefined;
}

export function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 40 && r.height > 20;
}


/* ───────── structural card discovery ───────── */
export function looksLikeCard(el: HTMLElement): boolean {
  const t = el.innerText;
  if (!t || t.length < 250 || t.length > 6000) return false;
  if (!EXP_RE.test(t)) return false;
  if (!SAL_RE.test(t) && !/notice/i.test(t)) return false;
  let n = 0;
  for (const s of SIGNALS) if (s.test(t)) n++;
  return n >= 2;
}

export function findCards(): HTMLElement[] {
  if (!document.body) return [];
  const minimal = new Set<HTMLElement>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || p.closest(`script,style,noscript,[${PILL_HOST_ATTR}]`)) return NodeFilter.FILTER_REJECT;
      return EXP_RE.test(n.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
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
  // Keep outermost when nested (the inner one is a fragment of the real card).
  const arr = [...minimal];
  const outer = arr.filter((a) => !arr.some((b) => b !== a && b.contains(a)));
  // Grow each minimal match upward while its parent still contains exactly one match (captures name/header rows).
  const set = new Set(outer);
  const grown = new Set<HTMLElement>();
  for (const m of outer) {
    let cur = m;
    for (let i = 0; i < 4; i++) {
      const p = cur.parentElement;
      if (!p || p === document.body) break;
      let count = 0;
      for (const o of set) if (p.contains(o)) count++;
      if (count !== 1 || (p.innerText?.length ?? 0) > 6000) break;
      cur = p;
    }
    if (visible(cur)) grown.add(cur);
  }
  return [...grown];
}

