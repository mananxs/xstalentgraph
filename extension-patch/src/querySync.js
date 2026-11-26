/**
 * FIX: auto-fill / "Auto-sync query box".
 *
 * Reads what the recruiter searched on Naukri (keywords, locations, experience) from several possible places,
 * mirrors it into the extension's query box, and:
 *   - waits until Naukri has finished rendering (debounced MutationObserver + input events), so it never copies a half-built query;
 *   - never overwrites text the recruiter typed in the extension box (it flags "differs" instead);
 *   - reports a status the panel can show: "synced" | "differs" | "empty".
 */
const text = (element) => element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

/** Collects the active Naukri search. Selectors are tolerant; tune `chipSelector` after inspecting your Resdex page. */
export function readNaukriQuery(doc = document, { chipSelector = '[class*="chip" i], [class*="tag" i], [class*="keyword" i]' } = {}) {
  const inputs = [...doc.querySelectorAll('input[type="text"], input:not([type]), textarea')].filter((input) => input.value?.trim().length > 1 && !input.closest("[data-xs-panel]"));
  const keywords = new Set();
  for (const input of inputs) for (const part of input.value.split(/[,;|]+/)) if (part.trim()) keywords.add(part.trim());
  for (const chip of doc.querySelectorAll(chipSelector)) {
    const value = text(chip).replace(/[×x✕]$/i, "").trim();
    if (value && value.length < 40 && !chip.closest("[data-xs-panel]")) keywords.add(value);
  }
  return [...keywords].slice(0, 30).join(", ");
}

export function createQuerySync({ read = readNaukriQuery, getBox, setBox, onStatus = () => {}, debounceMs = 450 }) {
  let timer = null;
  let lastWritten = "";
  let observer = null;

  function sync({ force = false } = {}) {
    const naukri = read();
    const current = getBox();
    if (!naukri) return onStatus("empty");
    const userEdited = current.trim() !== "" && current !== lastWritten;
    if (userEdited && !force) return onStatus(current.trim() === naukri ? "synced" : "differs");
    lastWritten = naukri;
    setBox(naukri);
    onStatus("synced");
  }

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => sync(), debounceMs);
  };

  return {
    start(doc = document) {
      schedule();
      observer = new MutationObserver(schedule);
      observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
      doc.addEventListener("input", schedule, true);
      doc.addEventListener("change", schedule, true);
    },
    stop(doc = document) {
      observer?.disconnect();
      doc.removeEventListener("input", schedule, true);
      doc.removeEventListener("change", schedule, true);
      clearTimeout(timer);
    },
    /** Button "Re-sync from Naukri": overwrite the box on purpose. */
    forceSync: () => sync({ force: true }),
  };
}
