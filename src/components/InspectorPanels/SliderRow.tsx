import { Slider } from "../ui/slider";

// Reusable slider row used across inspector sub-panels.
export function SliderRow({
  label,
  min,
  max,
  value,
  onChange,
  unit = "",
  formatValue,
  onReset,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  formatValue?: (v: number) => string;
  onReset?: () => void;
}) {
  const display = formatValue ? formatValue(value) : `${value}${unit}`;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[0.78rem] font-medium text-white/70">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[0.72rem] tabular-nums text-white/40">{display}</span>
          {onReset && (
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[0.65rem] text-white/35 transition hover:bg-white/6 hover:text-white/65"
              onClick={onReset}
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        className="**:data-[slot=slider-thumb]:bg-red-500"
      />
    </div>
  );
}
