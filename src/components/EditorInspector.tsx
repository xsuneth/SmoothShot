import { useRef } from "react";

import type { BackgroundStyle, BackgroundTab } from "../types";

type EditorInspectorProps = {
  audioGain: number;
  backgroundStyle: BackgroundStyle;
  backgroundImageFileName: string;
  exportPath: string;
  holdMs: number;
  isExporting: boolean;
  lastExportExists: boolean;
  maxZoom: number;
  padding: number;
  scalePercent: number;
  sessionDurationMs: number;
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
  onSetExportPath: (value: string) => void;
  onOpenExportedFile: () => void | Promise<void>;
  onSetBackgroundTab: (tab: BackgroundTab) => void;
  onSetBackgroundValue: (value: string) => void;
  onSetBackgroundBlur: (value: number) => void;
  onSetBackgroundImage: (file: File | null) => void;
};

const editorButtonClass =
  "rounded-xl border border-white/8 bg-white/5 px-4 py-2.5 text-[0.82rem] font-medium text-white transition duration-150 ease-out hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-45";

const inspectorInputClass =
  "w-full rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-white outline-none transition duration-150 ease-out focus-visible:ring-2 focus-visible:ring-[#8d7cff]";

const wallpaperSwatches = [
  { id: "macos", className: "from-[#3d63ff] via-[#6b4cff] to-[#28153f]" },
  { id: "spring", className: "from-[#68dfc2] via-[#37a7b5] to-[#223d63]" },
  { id: "sunset", className: "from-[#ffb36b] via-[#ff6f91] to-[#4d2042]" },
  { id: "radial", className: "from-[#6952e4] via-[#3f235f] to-[#160d23]" },
];

const gradientSwatches = [
  { id: "aurora", className: "from-[#30cfd0] to-[#330867]" },
  { id: "candy", className: "from-[#fa709a] to-[#fee140]" },
  { id: "ocean", className: "from-[#43cea2] to-[#185a9d]" },
  { id: "ember", className: "from-[#ffaf7b] to-[#d76d77]" },
];

const colorSwatches = [
  { id: "midnight", color: "#10131f" },
  { id: "plum", color: "#2d2344" },
  { id: "slate", color: "#19202c" },
  { id: "cream", color: "#ece2d0" },
];

export function EditorInspector({
  audioGain,
  backgroundStyle,
  backgroundImageFileName,
  exportPath,
  holdMs,
  isExporting,
  lastExportExists,
  maxZoom,
  padding,
  scalePercent,
  sessionDurationMs,
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
  onSetExportPath,
  onOpenExportedFile,
  onSetBackgroundTab,
  onSetBackgroundValue,
  onSetBackgroundBlur,
  onSetBackgroundImage,
}: EditorInspectorProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-r-[18px] border-l border-white/8 bg-[#17181f] p-4 text-white max-[1120px]:rounded-none max-[1120px]:border-l-0 max-[1120px]:border-t">
      <div className="mb-5">
        <h3 className="mb-3 text-xl font-semibold">Background</h3>
        <div className="flex gap-2 text-sm">
          {(["wallpaper", "gradient", "color", "image"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={backgroundStyle.tab === tab ? "rounded-xl bg-white/10 px-3 py-2" : "rounded-xl bg-white/4 px-3 py-2 text-white/78"}
              onClick={() => onSetBackgroundTab(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
        {backgroundStyle.tab === "wallpaper" && (
          <section>
            <p className="mb-3 text-sm font-medium text-white/85">Wallpaper</p>
            <div className="grid grid-cols-4 gap-2">
              {wallpaperSwatches.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  className={`aspect-square rounded-xl bg-gradient-to-br ${swatch.className} shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] ${backgroundStyle.value === swatch.id ? "ring-2 ring-[#9b88ff]" : ""}`}
                  onClick={() => onSetBackgroundValue(swatch.id)}
                />
              ))}
            </div>
          </section>
        )}

        {backgroundStyle.tab === "gradient" && (
          <section>
            <p className="mb-3 text-sm font-medium text-white/85">Gradient</p>
            <div className="grid grid-cols-4 gap-2">
              {gradientSwatches.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  className={`aspect-square rounded-xl bg-gradient-to-br ${swatch.className} shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] ${backgroundStyle.value === swatch.id ? "ring-2 ring-[#9b88ff]" : ""}`}
                  onClick={() => onSetBackgroundValue(swatch.id)}
                />
              ))}
            </div>
          </section>
        )}

        {backgroundStyle.tab === "color" && (
          <section>
            <p className="mb-3 text-sm font-medium text-white/85">Color</p>
            <div className="grid grid-cols-4 gap-2">
              {colorSwatches.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  className={`aspect-square rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ${backgroundStyle.value === swatch.id ? "ring-2 ring-[#9b88ff]" : ""}`}
                  style={{ backgroundColor: swatch.color }}
                  onClick={() => onSetBackgroundValue(swatch.id)}
                />
              ))}
            </div>
          </section>
        )}

        {backgroundStyle.tab === "image" && (
          <section>
            <label className="mb-2 block text-sm font-medium text-white/85">Background image</label>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => onSetBackgroundImage(event.currentTarget.files?.[0] ?? null)}
            />
            <div className="space-y-3">
              <button
                type="button"
                className="w-full rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-white transition hover:bg-white/8"
                onClick={() => imageInputRef.current?.click()}
              >
                Choose image
              </button>
              <input
                className={inspectorInputClass}
                type="text"
                value={backgroundImageFileName || backgroundStyle.value}
                placeholder="No image selected"
                readOnly
              />
            </div>
          </section>
        )}

        <section>
          <label className="mb-2 block text-sm font-medium text-white/85">Background blur</label>
          <input
            className="w-full accent-[#9b88ff]"
            type="range"
            min={0}
            max={24}
            value={backgroundStyle.blur}
            onChange={(event) => onSetBackgroundBlur(Number(event.currentTarget.value))}
          />
        </section>

        <section>
          <label className="mb-2 block text-sm font-medium text-white/85">Padding</label>
          <input className="w-full accent-[#9b88ff]" type="range" min={0} max={120} value={padding} onChange={(event) => onSetPadding(Number(event.currentTarget.value))} />
        </section>

        <section>
          <label className="mb-2 block text-sm font-medium text-white/85">Scale</label>
          <input className="w-full accent-[#9b88ff]" type="range" min={70} max={110} value={scalePercent} onChange={(event) => onSetScalePercent(Number(event.currentTarget.value))} />
        </section>

        <section className="space-y-3 border-t border-white/8 pt-4">
          <h4 className="text-sm font-semibold text-white/88">Zoom</h4>
          <label className="grid gap-1.5 text-sm text-white/70">
            <span>Max Zoom</span>
            <input className={inspectorInputClass} type="number" step="0.05" min={1.05} max={3} value={maxZoom} onChange={(event) => onSetMaxZoom(Number(event.currentTarget.value))} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <input className={inspectorInputClass} type="number" min={60} value={zoomInMs} onChange={(event) => onSetZoomInMs(Number(event.currentTarget.value))} />
            <input className={inspectorInputClass} type="number" min={0} value={holdMs} onChange={(event) => onSetHoldMs(Number(event.currentTarget.value))} />
            <input className={inspectorInputClass} type="number" min={80} value={zoomOutMs} onChange={(event) => onSetZoomOutMs(Number(event.currentTarget.value))} />
          </div>
        </section>

        <section className="space-y-3 border-t border-white/8 pt-4">
          <h4 className="text-sm font-semibold text-white/88">Trim</h4>
          <div className="grid grid-cols-2 gap-2">
            <input className={inspectorInputClass} type="number" min={0} max={Math.max(trimEndMs, 0)} value={trimStartMs} onChange={(event) => onSetTrimStartMs(Number(event.currentTarget.value))} />
            <input className={inspectorInputClass} type="number" min={trimStartMs} max={Math.max(sessionDurationMs, trimStartMs)} value={trimEndMs} onChange={(event) => onSetTrimEndMs(Number(event.currentTarget.value))} />
          </div>
        </section>

        <section className="space-y-3 border-t border-white/8 pt-4">
          <h4 className="text-sm font-semibold text-white/88">Audio</h4>
          <input className="w-full accent-[#9b88ff]" type="range" min={0} max={150} value={audioGain} onChange={(event) => onSetAudioGain(Number(event.currentTarget.value))} />
        </section>

        <section className="space-y-3 border-t border-white/8 pt-4">
          <h4 className="text-sm font-semibold text-white/88">Export</h4>
          <input
            className={inspectorInputClass}
            type="text"
            value={exportPath}
            onChange={(event) => onSetExportPath(event.currentTarget.value)}
            placeholder="D:/Videos/smoothshot.mp4"
            disabled={isExporting}
          />
          <button type="button" className={editorButtonClass} onClick={onOpenExportedFile} disabled={!lastExportExists}>
            Open File
          </button>
        </section>
      </div>
    </aside>
  );
}
