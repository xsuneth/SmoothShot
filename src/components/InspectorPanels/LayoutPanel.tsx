import { SliderRow } from "./SliderRow";

// Layout panel combines frame layout and timeline/export controls.
export function LayoutPanel({
  padding,
  scalePercent,
  maxZoom,
  zoomInMs,
  holdMs,
  zoomOutMs,
  trimStartMs,
  trimEndMs,
  sessionDurationMs,
  exportPath,
  isExporting,
  lastExportExists,
  onSetPadding,
  onSetScalePercent,
  onSetMaxZoom,
  onSetZoomInMs,
  onSetHoldMs,
  onSetZoomOutMs,
  onSetTrimStartMs,
  onSetTrimEndMs,
  onSetExportPath,
  onOpenExportedFile,
}: {
  padding: number;
  scalePercent: number;
  maxZoom: number;
  zoomInMs: number;
  holdMs: number;
  zoomOutMs: number;
  trimStartMs: number;
  trimEndMs: number;
  sessionDurationMs: number;
  exportPath: string;
  isExporting: boolean;
  lastExportExists: boolean;
  onSetPadding: (value: number) => void;
  onSetScalePercent: (value: number) => void;
  onSetMaxZoom: (value: number) => void;
  onSetZoomInMs: (value: number) => void;
  onSetHoldMs: (value: number) => void;
  onSetZoomOutMs: (value: number) => void;
  onSetTrimStartMs: (value: number) => void;
  onSetTrimEndMs: (value: number) => void;
  onSetExportPath: (value: string) => void;
  onOpenExportedFile: () => void | Promise<void>;
}) {
  const inputClass =
    "w-full rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-[0.82rem] text-white outline-none transition duration-150 ease-out focus-visible:ring-2 focus-visible:ring-[#8d7cff]";

  return (
    <>
      <div className="shrink-0 border-b border-white/6 px-4 py-3">
        <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Layout</p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="space-y-4 border-t border-white/6 pt-4">
          <SliderRow label="Padding" min={0} max={120} value={padding} onChange={onSetPadding} onReset={() => onSetPadding(32)} />
          <SliderRow label="Scale" min={70} max={110} value={scalePercent} onChange={onSetScalePercent} unit="%" onReset={() => onSetScalePercent(100)} />
        </section>

        <section className="space-y-3 border-t border-white/6 pt-4">
          <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Zoom</p>
          <SliderRow label="Max zoom" min={1.05} max={3} value={maxZoom} onChange={onSetMaxZoom} formatValue={(v) => `${v.toFixed(2)}x`} />
          <div className="grid grid-cols-3 gap-2 text-[0.72rem]">
            {[
              { label: "In", value: zoomInMs, min: 60, onChange: onSetZoomInMs },
              { label: "Hold", value: holdMs, min: 0, onChange: onSetHoldMs },
              { label: "Out", value: zoomOutMs, min: 80, onChange: onSetZoomOutMs },
            ].map(({ label, value, min, onChange }) => (
              <label key={label} className="flex flex-col gap-1">
                <span className="text-white/45">{label}</span>
                <input className={inputClass + " text-center"} type="number" min={min} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))} />
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-2 border-t border-white/6 pt-4">
          <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Trim</p>
          <div className="grid grid-cols-2 gap-2 text-[0.72rem]">
            <label className="flex flex-col gap-1">
              <span className="text-white/45">Start (ms)</span>
              <input className={inputClass} type="number" min={0} max={Math.max(trimEndMs, 0)} value={trimStartMs} onChange={(e) => onSetTrimStartMs(Number(e.currentTarget.value))} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-white/45">End (ms)</span>
              <input className={inputClass} type="number" min={trimStartMs} max={Math.max(sessionDurationMs, trimStartMs)} value={trimEndMs} onChange={(e) => onSetTrimEndMs(Number(e.currentTarget.value))} />
            </label>
          </div>
        </section>

        <section className="space-y-3 border-t border-white/6 pt-4 pb-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Export</p>
          <input
            className={inputClass}
            type="text"
            value={exportPath}
            onChange={(e) => onSetExportPath(e.currentTarget.value)}
            placeholder="D:/Videos/smoothshot.mp4"
            disabled={isExporting}
          />
          <button
            type="button"
            className="w-full rounded-xl border border-white/8 bg-white/5 px-4 py-2.5 text-[0.82rem] font-medium text-white transition hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onOpenExportedFile}
            disabled={!lastExportExists}
          >
            Open exported file
          </button>
        </section>
      </div>
    </>
  );
}
