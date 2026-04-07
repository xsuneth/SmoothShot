import { useRef } from "react";

import type { BackgroundStyle, BackgroundTab, CameraCorner, PreviewToolPanel } from "../types";

type EditorInspectorProps = {
  activeToolPanel: PreviewToolPanel;
  audioGain: number;
  backgroundStyle: BackgroundStyle;
  backgroundImageFileName: string;
  cameraCorner: CameraCorner;
  cameraMirrored: boolean;
  cameraRoundness: number;
  cursorScale: number;
  exportPath: string;
  holdMs: number;
  isExporting: boolean;
  lastExportExists: boolean;
  maxZoom: number;
  padding: number;
  scalePercent: number;
  sessionDurationMs: number;
  showCursor: boolean;
  trimEndMs: number;
  trimStartMs: number;
  zoomInMs: number;
  zoomOutMs: number;
  onSetTrimStartMs: (value: number) => void;
  onSetTrimEndMs: (value: number) => void;
  onSetPadding: (value: number) => void;
  onSetScalePercent: (value: number) => void;
  onSetMaxZoom: (value: number) => void;
  onSetZoomInMs: (value: number) => void;
  onSetHoldMs: (value: number) => void;
  onSetZoomOutMs: (value: number) => void;
  onSetAudioGain: (value: number) => void;
  onSetCameraCorner: (corner: CameraCorner) => void;
  onSetCameraMirrored: (mirrored: boolean) => void;
  onSetCameraRoundness: (roundness: number) => void;
  onSetCursorScale: (value: number) => void;
  onSetShowCursor: (value: boolean) => void;
  onSetExportPath: (value: string) => void;
  onOpenExportedFile: () => void | Promise<void>;
  onSetBackgroundTab: (tab: BackgroundTab) => void;
  onSetBackgroundValue: (value: string) => void;
  onSetBackgroundBlur: (value: number) => void;
  onSetBackgroundImage: (file: File | null) => void;
};

const inspectorInputClass =
  "w-full rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-[0.82rem] text-white outline-none transition duration-150 ease-out focus-visible:ring-2 focus-visible:ring-[#8d7cff]";

const wallpaperSwatches = Array.from({ length: 18 }, (_, index) => {
  const value = `/wallpapers/wallpaper${index + 1}.jpg`;
  return { id: value, value };
});

const gradientSwatches = [
  { id: "aurora", className: "from-[#30cfd0] to-[#330867]" },
  { id: "candy",  className: "from-[#fa709a] to-[#fee140]" },
  { id: "ocean",  className: "from-[#43cea2] to-[#185a9d]" },
  { id: "ember",  className: "from-[#ffaf7b] to-[#d76d77]" },
  { id: "dusk",   className: "from-[#8360c3] to-[#2ebf91]" },
  { id: "fire",   className: "from-[#f12711] to-[#f5af19]" },
  { id: "cool",   className: "from-[#2193b0] to-[#6dd5ed]" },
  { id: "plum",   className: "from-[#360033] to-[#0b8793]" },
];

const colorSwatches = [
  { id: "midnight", color: "#10131f" },
  { id: "plum",     color: "#2d2344" },
  { id: "slate",    color: "#19202c" },
  { id: "cream",    color: "#ece2d0" },
  { id: "graphite", color: "#1c1c1e" },
  { id: "forest",   color: "#0d1f0d" },
  { id: "navy",     color: "#0a1628" },
  { id: "rose",     color: "#2a1218" },
];

function SliderRow({
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
      <input
        className="w-full cursor-pointer accent-[#9b88ff]"
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </div>
  );
}

export function EditorInspector({
  activeToolPanel,
  audioGain,
  backgroundStyle,
  backgroundImageFileName,
  cameraCorner,
  cameraMirrored,
  cameraRoundness,
  cursorScale,
  exportPath,
  holdMs,
  isExporting,
  lastExportExists,
  maxZoom,
  padding,
  scalePercent,
  sessionDurationMs,
  showCursor,
  trimEndMs,
  trimStartMs,
  zoomInMs,
  zoomOutMs,
  onSetTrimStartMs,
  onSetTrimEndMs,
  onSetPadding,
  onSetScalePercent,
  onSetMaxZoom,
  onSetZoomInMs,
  onSetHoldMs,
  onSetZoomOutMs,
  onSetAudioGain,
  onSetCameraCorner,
  onSetCameraMirrored,
  onSetCameraRoundness,
  onSetCursorScale,
  onSetShowCursor,
  onSetExportPath,
  onOpenExportedFile,
  onSetBackgroundTab,
  onSetBackgroundValue,
  onSetBackgroundBlur,
  onSetBackgroundImage,
}: EditorInspectorProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const tabClass = (active: boolean) =>
    active
      ? "rounded-lg bg-white/12 px-2.5 py-1.5 text-[0.75rem] font-medium text-white"
      : "rounded-lg px-2.5 py-1.5 text-[0.75rem] text-white/55 transition hover:bg-white/6 hover:text-white/80";

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-r-[18px] border-l border-white/6 bg-[#14151c] text-white max-[1120px]:rounded-none max-[1120px]:border-l-0 max-[1120px]:border-t">
      {/* Active tool panel */}
      <div className="shrink-0 border-b border-white/6 px-4 py-3">
        <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">{activeToolPanel}</p>
        {activeToolPanel === "Background" && (
          <div className="mt-2.5 flex gap-1">
            {(["wallpaper", "gradient", "color", "image"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={tabClass(backgroundStyle.tab === tab)}
                onClick={() => onSetBackgroundTab(tab)}
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">

        {activeToolPanel === "Background" && backgroundStyle.tab === "wallpaper" && (
          <section>
            <div className="grid grid-cols-4 gap-2">
              {wallpaperSwatches.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  className={`aspect-square rounded-xl bg-center bg-cover shadow-[inset_0_1px_0_rgba(255,255,255,0.20)] transition hover:scale-105 ${backgroundStyle.value === swatch.value ? "ring-2 ring-[#9b88ff] ring-offset-1 ring-offset-[#14151c]" : ""}`}
                  style={{ backgroundImage: `url("${swatch.value}")` }}
                  onClick={() => onSetBackgroundValue(swatch.value)}
                />
              ))}
            </div>
          </section>
        )}

        {activeToolPanel === "Background" && backgroundStyle.tab === "gradient" && (
          <section>
            <div className="grid grid-cols-4 gap-2">
              {gradientSwatches.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  className={`aspect-square rounded-xl bg-gradient-to-br ${swatch.className} shadow-[inset_0_1px_0_rgba(255,255,255,0.20)] transition hover:scale-105 ${backgroundStyle.value === swatch.id ? "ring-2 ring-[#9b88ff] ring-offset-1 ring-offset-[#14151c]" : ""}`}
                  onClick={() => onSetBackgroundValue(swatch.id)}
                />
              ))}
            </div>
          </section>
        )}

        {activeToolPanel === "Background" && backgroundStyle.tab === "color" && (
          <section>
            <div className="grid grid-cols-4 gap-2">
              {colorSwatches.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  className={`aspect-square rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] transition hover:scale-105 ${backgroundStyle.value === swatch.id ? "ring-2 ring-[#9b88ff] ring-offset-1 ring-offset-[#14151c]" : ""}`}
                  style={{ backgroundColor: swatch.color }}
                  onClick={() => onSetBackgroundValue(swatch.id)}
                />
              ))}
            </div>
          </section>
        )}

        {activeToolPanel === "Background" && backgroundStyle.tab === "image" && (
          <section className="space-y-2">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => onSetBackgroundImage(event.currentTarget.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="w-full rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-[0.82rem] text-white/80 transition hover:bg-white/8"
              onClick={() => imageInputRef.current?.click()}
            >
              Choose image…
            </button>
            <input
              className={inspectorInputClass}
              type="text"
              value={backgroundImageFileName || backgroundStyle.value}
              placeholder="No image selected"
              readOnly
            />
          </section>
        )}

        {activeToolPanel === "Background" && (
          <section className="space-y-4 border-t border-white/6 pt-4">
            <SliderRow
              label="Background blur"
              min={0}
              max={24}
              value={backgroundStyle.blur}
              onChange={onSetBackgroundBlur}
              unit="px"
              onReset={() => onSetBackgroundBlur(0)}
            />
            <SliderRow
              label="Padding"
              min={0}
              max={120}
              value={padding}
              onChange={onSetPadding}
              onReset={() => onSetPadding(32)}
            />
            <SliderRow
              label="Scale"
              min={70}
              max={110}
              value={scalePercent}
              onChange={onSetScalePercent}
              unit="%"
              onReset={() => onSetScalePercent(100)}
            />
          </section>
        )}

        {activeToolPanel === "Cursor" && (
          <section className="space-y-3 border-t border-white/6 pt-4">
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-white/4 px-2.5 py-2 text-[0.76rem]">
              <span className="text-white/72">Show cursor</span>
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[#9b88ff]"
                checked={showCursor}
                onChange={(e) => onSetShowCursor(e.currentTarget.checked)}
              />
            </label>
            <SliderRow
              label="Cursor size"
              min={70}
              max={180}
              value={cursorScale}
              onChange={onSetCursorScale}
              unit="%"
            />
          </section>
        )}

        {activeToolPanel === "Camera" && (
          <section className="space-y-3 border-t border-white/6 pt-4">
            <label className="block">
              <span className="mb-1 block text-[0.74rem] text-white/68">Corner</span>
              <select
                className="w-full rounded-lg border border-white/10 bg-white/6 px-2 py-1.5 text-[0.76rem] outline-none focus-visible:ring-2 focus-visible:ring-[#8d7cff]"
                value={cameraCorner}
                onChange={(e) => onSetCameraCorner(e.currentTarget.value as CameraCorner)}
              >
                <option value="top-left">Top left</option>
                <option value="top-right">Top right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="bottom-right">Bottom right</option>
              </select>
            </label>
            <SliderRow
              label="Roundness"
              min={0}
              max={40}
              value={cameraRoundness}
              onChange={onSetCameraRoundness}
              unit="px"
            />
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-white/4 px-2.5 py-2 text-[0.76rem]">
              <span className="text-white/72">Mirror</span>
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[#9b88ff]"
                checked={cameraMirrored}
                onChange={(e) => onSetCameraMirrored(e.currentTarget.checked)}
              />
            </label>
          </section>
        )}

        {/* Zoom */}
        <section className="space-y-3 border-t border-white/6 pt-4">
          <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Zoom</p>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[0.78rem] font-medium text-white/70">Max zoom</span>
              <span className="text-[0.72rem] tabular-nums text-white/40">{maxZoom}×</span>
            </div>
            <input
              className="w-full cursor-pointer accent-[#9b88ff]"
              type="range"
              step={0.05}
              min={1.05}
              max={3}
              value={maxZoom}
              onChange={(e) => onSetMaxZoom(Number(e.currentTarget.value))}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 text-[0.72rem]">
            {[
              { label: "In", value: zoomInMs,  min: 60,  onChange: onSetZoomInMs  },
              { label: "Hold", value: holdMs,    min: 0,   onChange: onSetHoldMs   },
              { label: "Out", value: zoomOutMs, min: 80,  onChange: onSetZoomOutMs },
            ].map(({ label, value, min, onChange }) => (
              <label key={label} className="flex flex-col gap-1">
                <span className="text-white/45">{label}</span>
                <input
                  className={inspectorInputClass + " text-center"}
                  type="number"
                  min={min}
                  value={value}
                  onChange={(e) => onChange(Number(e.currentTarget.value))}
                />
              </label>
            ))}
          </div>
        </section>

        {/* Trim */}
        <section className="space-y-2 border-t border-white/6 pt-4">
          <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Trim</p>
          <div className="grid grid-cols-2 gap-2 text-[0.72rem]">
            <label className="flex flex-col gap-1">
              <span className="text-white/45">Start (ms)</span>
              <input
                className={inspectorInputClass}
                type="number"
                min={0}
                max={Math.max(trimEndMs, 0)}
                value={trimStartMs}
                onChange={(e) => onSetTrimStartMs(Number(e.currentTarget.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-white/45">End (ms)</span>
              <input
                className={inspectorInputClass}
                type="number"
                min={trimStartMs}
                max={Math.max(sessionDurationMs, trimStartMs)}
                value={trimEndMs}
                onChange={(e) => onSetTrimEndMs(Number(e.currentTarget.value))}
              />
            </label>
          </div>
        </section>

        {/* Audio */}
        <section className="border-t border-white/6 pt-4">
          <SliderRow
            label="Audio gain"
            min={0}
            max={150}
            value={audioGain}
            onChange={onSetAudioGain}
            unit="%"
            onReset={() => onSetAudioGain(100)}
          />
        </section>

        {/* Export */}
        <section className="space-y-3 border-t border-white/6 pt-4 pb-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Export</p>
          <input
            className={inspectorInputClass}
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
    </aside>
  );
}
