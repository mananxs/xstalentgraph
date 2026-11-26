/**
 * FIX: "same name card for different candidates".
 *
 * Symptom (your screenshots): ranks 6, 7, 17, 18 all read "Pooja Jaiswar, Consulting Engineer at Capgemini", while a
 * click on each card opens a different profile. Pooja's profile was the one open in the page, so the card reader was
 * pulling the name/headline from page-level selectors (the open profile / first match in the document) and caching the
 * analysis under a key that did not include the person.
 *
 * Rules enforced here:
 *   1. Everything is read from INSIDE one card root. Never document.querySelector for candidate fields.
 *   2. Every card gets a stable identity key: the Naukri profile id when one can be found, else a hash of
 *      name + experience + current role + location + CTC. Two different people can no longer share a key.
 *   3. Analyses are stored under `${jdHash}::${identity.key}` and are verified against the name on the card before use.
 */

export const DEFAULTS = {
  /** Set to the real card container selector once you have looked at one card's HTML (e.g. ".tuple"). null = auto-detect. */
  rootSelector: null,
  /** Selector for the candidate name inside a card. null = auto-detect. */
  nameSelector: null,
  /** Links that open a candidate profile. */
  profileLinkSelector: 'a[href*="candidate"], a[href*="profile"], a[href*="/cv"], a[data-candidate-id], a[data-profile-id]',
};

const ID_ATTRS = ["data-candidate-id", "data-profile-id", "data-uid", "data-cid", "data-id", "data-tuple-id"];
const ID_PARAMS = ["candidateId", "candidateid", "cid", "uid", "profileId", "profileid", "id", "resdexId"];
const LABELS = { current: /^current$/i, previous: /^previous$/i, education: /^education$/i, prefLocations: /^pref\.? locations?$/i, keySkills: /^key skills?$/i };

export const normalize = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Small synchronous string hash (FNV-1a, 32 bit) rendered as hex. Not for security, only for identity keys. */
export function hashString(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Builds the identity of a card from facts read INSIDE the card. Pure function. */
export function buildIdentity({ id, name, experience, current, location, ctc }) {
  const signature = [name, experience, current, location, ctc].map(normalize).join("|");
  if (id) return { key: `id_${normalize(id)}`, idSource: "naukri-id", signature };
  return { key: `h_${hashString(signature)}${hashString(signature.split("").reverse().join(""))}`, idSource: "hash", signature };
}

function idFromUrl(href) {
  try {
    const url = new URL(href, "https://resdex.naukri.com");
    for (const param of ID_PARAMS) {
      const value = url.searchParams.get(param);
      if (value) return value;
    }
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last && /[a-z0-9]{6,}/i.test(last) && !/^(candidate|profile|cv|search)$/i.test(last) ? last : null;
  } catch {
    return null;
  }
}

/** Finds the card containers. Uses `rootSelector` when given, otherwise climbs from each profile link to the card. */
export function findCardRoots(doc = document, options = {}) {
  const { rootSelector, profileLinkSelector } = { ...DEFAULTS, ...options };
  if (rootSelector) return [...doc.querySelectorAll(rootSelector)];

  const links = [...doc.querySelectorAll(profileLinkSelector)].filter((link) => normalize(link.textContent).length >= 3);
  const roots = new Set();
  for (const link of links) {
    let node = link;
    // Climb while the parent still contains only THIS candidate's links (same target); stop before it holds a second candidate.
    while (node.parentElement) {
      const parent = node.parentElement;
      const targets = new Set([...parent.querySelectorAll(profileLinkSelector)].map((a) => a.getAttribute("href") || a.textContent));
      if (targets.size > 1 || parent === doc.body) break;
      node = parent;
    }
    roots.add(node);
  }
  return [...roots];
}

function labelledValue(root, pattern) {
  for (const element of root.querySelectorAll("*")) {
    if (element.children.length === 0 && pattern.test(element.textContent.trim())) {
      const next = element.nextElementSibling ?? element.parentElement?.nextElementSibling;
      const text = next?.textContent?.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
  }
  return null;
}

function readName(root, nameSelector) {
  if (nameSelector) return root.querySelector(nameSelector)?.textContent?.trim() ?? null;
  const candidates = root.querySelectorAll('a, h1, h2, h3, h4, [class*="name" i], [class*="title" i]');
  for (const element of candidates) {
    const text = element.textContent.replace(/\s+/g, " ").trim();
    if (/^[A-Za-z][A-Za-z .'-]{2,60}$/.test(text) && text.split(" ").length <= 5 && !/^(select all|view phone number|call candidate|save|comment|more)$/i.test(text)) return text;
  }
  return null;
}

/** Reads ONE card. Returns null when the root does not look like a candidate card. Never looks outside `root`. */
export function readCard(root, options = {}) {
  const { nameSelector, profileLinkSelector } = { ...DEFAULTS, ...options };
  const name = readName(root, nameSelector);
  if (!name) return null;

  const text = root.textContent.replace(/\s+/g, " ");
  const exp = /(\d{1,2})\s*y(?:rs?)?\s*(\d{1,2})?\s*m?/i.exec(text);
  const experience = exp ? `${exp[1]}y ${exp[2] ?? 0}m` : null;
  const ctc = /₹\s*([\d.,]+)\s*(lacs?|lakhs?|cr)/i.exec(text);
  const link = root.querySelector(profileLinkSelector);

  let id = null;
  for (const attr of ID_ATTRS) id ??= root.getAttribute(attr) ?? root.querySelector(`[${attr}]`)?.getAttribute(attr) ?? null;
  id ??= root.querySelector('input[type="checkbox"][value]')?.value || null;
  id ??= link ? idFromUrl(link.getAttribute("href") ?? "") : null;

  const current = labelledValue(root, LABELS.current);
  const location = labelledValue(root, LABELS.prefLocations);
  const skillsText = labelledValue(root, LABELS.keySkills);
  const identity = buildIdentity({ id, name, experience, current, location, ctc: ctc ? `${ctc[1]} ${ctc[2]}` : null });

  return {
    ...identity,
    id,
    name,
    experience,
    experienceYears: exp ? Number(exp[1]) + Number(exp[2] ?? 0) / 12 : null,
    ctc: ctc ? `${ctc[1]} ${ctc[2]}` : null,
    current,
    location,
    skills: skillsText ? skillsText.split(/\s*\|\s*|\s{2,}/).filter(Boolean).slice(0, 40) : [],
    profileUrl: link ? new URL(link.getAttribute("href") ?? "", "https://resdex.naukri.com").href : null,
    root,
  };
}

/** Reads every card on the page, drops exact repeats of the same identity key, keeps page order. */
export function readAllCards(doc = document, options = {}) {
  const seen = new Set();
  const cards = [];
  for (const root of findCardRoots(doc, options)) {
    const card = readCard(root, options);
    if (!card || seen.has(card.key)) continue;
    seen.add(card.key);
    cards.push(card);
  }
  return cards;
}

/** Analysis cache keyed by job + identity. `verify` refuses an analysis that belongs to a different person. */
export function createAnalysisStore() {
  const map = new Map();
  const keyOf = (jdHash, card) => `${jdHash}::${card.key}`;
  return {
    get(jdHash, card) {
      const entry = map.get(keyOf(jdHash, card));
      if (!entry) return null;
      // Defence in depth: a stored analysis is only valid for the exact person it was made for.
      return normalize(entry.forName) === normalize(card.name) && entry.signature === card.signature ? entry.analysis : null;
    },
    set(jdHash, card, analysis) {
      map.set(keyOf(jdHash, card), { analysis, forName: card.name, signature: card.signature });
    },
    clear: () => map.clear(),
    size: () => map.size,
  };
}
