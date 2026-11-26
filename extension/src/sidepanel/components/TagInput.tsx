import { useState } from "react";

/** Chip input: Enter / comma adds, ✕ or Backspace removes. */
export default function TagInput({ value, onChange, tone, placeholder }: { value: string[]; onChange: (v: string[]) => void; tone: string; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!items.length) return setDraft("");
    const have = new Set(value.map((v) => v.toLowerCase()));
    onChange([...value, ...items.filter((i) => !have.has(i.toLowerCase()))]);
    setDraft("");
  };
  return (
    <div className="flex min-h-[34px] flex-wrap items-center gap-1 rounded-md border border-slate-300 bg-white p-1 focus-within:border-indigo-500">
      {value.map((t) => (
        <span key={t} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
          {t}
          <button type="button" aria-label={`Remove ${t}`} className="opacity-50 hover:opacity-100" onClick={() => onChange(value.filter((v) => v !== t))}>
            ✕
          </button>
        </span>
      ))}
      <input
        className="min-w-[80px] flex-1 bg-transparent px-1 py-0.5 text-[12px] outline-none"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}
