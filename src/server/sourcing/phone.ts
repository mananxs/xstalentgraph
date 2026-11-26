/**
 * Zero-cost phone extraction for the Indian market.
 *
 * Many candidates paste their number into their LinkedIn summary and Google indexes it, so it shows up in the
 * SERP snippet. This scans free text for Indian MOBILE numbers and returns them in one canonical format.
 *
 * What counts as a mobile number: 10 digits, the first one 6-9 (the numbering plan for mobiles), optionally
 * prefixed by a country code (+91, 91, (+91), 0091) or the national trunk prefix 0, and written
 * in any common grouping:
 *   9876543210   98765 43210   98765-43210   9876 543 210   98 76 54 32 10   (+91) 98765.43210
 *   +91 98765 43210   +91-9876543210   919876543210   09876543210   0 98765 43210
 *
 * What it must NOT match (these are the false positives that waste a recruiter's call):
 *   - foreign numbers ("+44 7911 123456" has 10 digits starting with 7 after the country code),
 *   - landlines with an STD code ("080 6123 4567", "079 2345 6789": Bengaluru / Ahmedabad),
 *   - digits that are the tail of a longer number (order ids, timestamps),
 *   - placeholder numbers ("9999999999", "9876543210").
 */

/** Optional prefix, then 10 digits (first 6-9), each digit optionally followed by ONE separator. */
const SEP = "[\\s.\\-\\u2013\\u2014]";
const INDIAN_MOBILE = new RegExp(
  // not the tail of a longer number, and not directly after another country code such as "+44 "
  `(?<![\\d])(?<!\\+\\d{1,3}${SEP}*)(?<!\\d${SEP})` +
    // optional prefix: (+91) / +91 / 91 / 0091 / 0
    `(?:(?:\\(?\\+?(?:00)?91\\)?${SEP}*)|(?:0${SEP}?))?` +
    // the 10 mobile digits
    `([6-9](?:${SEP}?\\d){9})` +
    // not followed by more digits
    `(?!\\d)`,
  "g",
);

/** Landline STD codes whose 2nd/3rd digit look like a mobile start: 080 (Bengaluru), 079 (Ahmedabad). */
const LANDLINE_AFTER_ZERO = /^0\s*(?:80|79)[\s.\-–—]/;

/** Placeholder-looking numbers that appear in samples and spam, never a real person. */
function looksFake(tenDigits: string): boolean {
  if (/^(\d)\1{9}$/.test(tenDigits)) return true; // 9999999999
  if (tenDigits === "9876543210" || tenDigits === "9123456789" || tenDigits === "8123456789") return true;
  return false;
}

/** "+91" + 10 digits: the only format we store, so the same person's number always compares equal. */
export function toE164India(tenDigits: string): string {
  return `+91${tenDigits}`;
}

/**
 * Finds every Indian mobile number in the text, normalised to "+91XXXXXXXXXX", de-duplicated, in order of
 * appearance. Returns [] for empty / non-string input. Never throws.
 */
export function extractIndianMobiles(text: string | null | undefined): string[] {
  if (typeof text !== "string" || text.length < 10) return [];

  const found: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(INDIAN_MOBILE)) {
    const whole = match[0];
    const digits = (match[1] ?? "").replace(/\D/g, "");
    if (digits.length !== 10) continue;
    if (LANDLINE_AFTER_ZERO.test(whole.trimStart())) continue;
    if (looksFake(digits)) continue;

    const normalised = toE164India(digits);
    if (!seen.has(normalised)) {
      seen.add(normalised);
      found.push(normalised);
    }
  }
  return found;
}

/** The first Indian mobile number in the text, or null. This is what goes into `candidates.phone`. */
export function extractIndianMobile(text: string | null | undefined): string | null {
  return extractIndianMobiles(text)[0] ?? null;
}

/** Removes every phone number from the text (used before text goes to a model or into profileText). */
export function stripIndianMobiles(text: string): string {
  return text.replace(INDIAN_MOBILE, (whole) => (LANDLINE_AFTER_ZERO.test(whole.trimStart()) ? whole : " "));
}
