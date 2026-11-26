/**
 * Contact details from candidate text (Resdex profile, résumé). Regex-only, so it also works when the LLM missed or never saw the block.
 * Handles "+91 98765 43210", "98765-43210", "(+91) 9876543210", "09876543210" and flags masked numbers ("98XXXXXX10", "98******10").
 */
export interface Contacts {
  emails: string[];
  /** Normalised: Indian mobiles → "+91XXXXXXXXXX"; other international numbers keep their "+" form. */
  phones: string[];
  /** The text shows a number but it is masked (Resdex hides it until the profile's contact details are unlocked). */
  phoneMasked: boolean;
}

/** → "+919876543210" for Indian mobiles, "+<digits>" for other international numbers, "" when it isn't a phone. */
export function normalizePhone(raw: string | null | undefined): string {
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
// optional +91 / 0 prefix, then 10 digits (first 6-9) with optional single separators; not part of a longer digit run
const IN_MOBILE = /(?<![\d])(?:\(?\+?\s*91\)?[\s\-.]*|0[\s\-.]*)?([6-9](?:[\s\-.]?\d){9})(?![\d])/g;
const INTL = /(?<![\d\w])\+(?!91\b)\d{1,3}[\s\-.]?(?:\(?\d{1,4}\)?[\s\-.]?){2,4}\d{2,4}(?![\d])/g;
const MASKED = /(?<![\d])[6-9]\d?[xX*•●]{3,}\d{0,3}(?![\d])|\b(?:xxxx+|\*{4,})\b/;

export function extractContacts(text: string | null | undefined): Contacts {
  const t = text ?? "";
  const emails = [...new Set((t.match(EMAIL) ?? []).filter((e) => !/\*|xxx/i.test(e)).map((e) => e.toLowerCase()))];
  const phones: string[] = [];
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
