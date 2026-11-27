interface ScoreFilterProps {
  value: number;
  onChange: (value: number) => void;
}

/** Slider that hides candidates below a minimum score. */
export function ScoreFilter({ value, onChange }: ScoreFilterProps) {
  return (
    <div className="flex items-center gap-3 text-sm text-zinc-700">
      <label htmlFor="min-score">Minimum score</label>
      <input
        id="min-score"
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-32 cursor-pointer accent-[#4f46e5] sm:w-44"
      />
      <output htmlFor="min-score" className="w-8 tabular-nums text-zinc-950">
        {value}
      </output>
    </div>
  );
}
