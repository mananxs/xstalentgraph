/** Small non-cryptographic string hash (djb2) → base36. Used for cache / dedupe keys. */
export function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Does an AI result really describe THIS card? The scorer returned the same name/verdict for several different candidates,
 * so every result is checked against the card's own text: the extracted name (and company, when given) must appear in it.
 * A result with no `extracted` block (older server) or an unreadable/empty name cannot be checked, so it is accepted: the panel
 * then shows the name read locally from the card, never the model's.
 */
export function resultMatchesCard(extracted: { fullName?: string; currentCompany?: string } | undefined, rawText: string): boolean {
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
