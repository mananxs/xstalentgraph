/**
 * Form-field helpers shared by "Fill Resdex Search" (writes values) and the live search-state reader (reads values).
 * Resdex's class names are obfuscated and change, so fields are identified by what a human sees: placeholder, aria-label, name,
 * id, <label> text and the short label sitting just before the input.
 */
export const PILL_HOST_ATTR = "data-ai-pill-host";

export type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export const SKIP_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "file", "hidden", "image", "password", "email", "tel"]);

export function labelText(el: Field): string {
  const bits: string[] = [];
  if (el.id) document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => bits.push(l.textContent ?? ""));
  const wrap = el.closest("label");
  if (wrap) bits.push(wrap.textContent ?? "");
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) for (const id of labelledBy.split(/\s+/)) bits.push(document.getElementById(id)?.textContent ?? "");
  // The element's own preceding short label (Resdex often renders "Experience" as a sibling <label>/<span>/<div>).
  // One step only, and never a container that holds other fields — otherwise a neighbouring field's label leaks in.
  const prev = el.previousElementSibling ?? (el.parentElement?.children.length === 1 ? el.parentElement.previousElementSibling : null);
  if (prev && !prev.querySelector("input,select,textarea") && !/^(INPUT|SELECT|TEXTAREA)$/.test(prev.tagName)) {
    const t = (prev.textContent ?? "").trim();
    if (t && t.length < 40) bits.push(t);
  }
  return bits.join(" ");
}

export function describe(el: Field): string {
  return [el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("name"), el.id, el.getAttribute("title"), el.getAttribute("data-testid"), labelText(el)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Visible, editable text-like controls (inputs, textareas, selects) — never our own pills. */
export function formFields(): { el: Field; d: string }[] {
  return [...document.querySelectorAll<Field>("input, textarea, select")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (el.closest(`[${PILL_HOST_ATTR}]`) || el.disabled || r.width < 20 || r.height < 12) return false;
      if (el instanceof HTMLInputElement) return !SKIP_INPUT_TYPES.has(el.type) && !el.readOnly;
      if (el instanceof HTMLTextAreaElement) return !el.readOnly;
      return true;
    })
    .map((el) => ({ el, d: describe(el) }));
}

export function setValue(el: Field, value: string): boolean {
  if (el instanceof HTMLSelectElement) {
    const want = value.trim();
    const num = parseFloat(want);
    const opt = [...el.options].find((o) => {
      const v = o.value.trim();
      const t = (o.textContent ?? "").trim();
      if (v === want || t === want) return true;
      const tn = parseFloat(t.replace(/[^\d.]/g, ""));
      return !Number.isNaN(num) && !Number.isNaN(tn) && /^\s*\d+(\.\d+)?\s*(\+|yrs?|years?)?\s*$/i.test(t) && tn === num;
    });
    if (!opt) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter ? setter.call(el, opt.value) : (el.value = opt.value);
  } else {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}
