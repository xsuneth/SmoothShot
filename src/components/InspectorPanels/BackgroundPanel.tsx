import { useId } from "react";

import type { BackgroundStyle, BackgroundTab } from "../../types";
import { SliderRow } from "./SliderRow";

// Background panel combines look and frame-style controls for the first tool icon.
export function BackgroundPanel({
  backgroundStyle,
  backgroundImageFileName,
  padding,
  roundedCorners,
  inset,
  shadow,
  directionalShadow,
  shadowAngle,
  shadowBlur,
  onSetBackgroundTab,
  onSetBackgroundValue,
  onSetBackgroundBlur,
  onSetBackgroundImage,
  onSetPadding,
  onSetRoundedCorners,
  onSetInset,
  onSetShadow,
  onSetDirectionalShadow,
  onSetShadowAngle,
  onSetShadowBlur,
}: {
  backgroundStyle: BackgroundStyle;
  backgroundImageFileName: string;
  padding: number;
  roundedCorners: number;
  inset: number;
  shadow: number;
  directionalShadow: boolean;
  shadowAngle: number;
  shadowBlur: number;
  onSetBackgroundTab: (tab: BackgroundTab) => void;
  onSetBackgroundValue: (value: string) => void;
  onSetBackgroundBlur: (value: number) => void;
  onSetBackgroundImage: (file: File | null) => void;
  onSetPadding: (value: number) => void;
  onSetRoundedCorners: (value: number) => void;
  onSetInset: (value: number) => void;
  onSetShadow: (value: number) => void;
  onSetDirectionalShadow: (value: boolean) => void;
  onSetShadowAngle: (value: number) => void;
  onSetShadowBlur: (value: number) => void;
}) {
  const imageInputId = useId();

  const wallpaperSwatches = Array.from({ length: 18 }, (_, index) => {
    const value = `/wallpapers/wallpaper${index + 1}.jpg`;
    return { id: value, value };
  });

  const gradientSwatches = [
    { id: "aurora", className: "from-[#30cfd0] to-[#330867]" },
    { id: "candy", className: "from-[#fa709a] to-[#fee140]" },
    { id: "ocean", className: "from-[#43cea2] to-[#185a9d]" },
    { id: "ember", className: "from-[#ffaf7b] to-[#d76d77]" },
    { id: "dusk", className: "from-[#8360c3] to-[#2ebf91]" },
    { id: "fire", className: "from-[#f12711] to-[#f5af19]" },
    { id: "cool", className: "from-[#2193b0] to-[#6dd5ed]" },
    { id: "plum", className: "from-[#360033] to-[#0b8793]" },
  ];

  const colorSwatches = [
    { id: "midnight", color: "#10131f" },
    { id: "plum", color: "#2d2344" },
    { id: "slate", color: "#19202c" },
    { id: "cream", color: "#ece2d0" },
    { id: "graphite", color: "#1c1c1e" },
    { id: "forest", color: "#0d1f0d" },
    { id: "navy", color: "#0a1628" },
    { id: "rose", color: "#2a1218" },
  ];

  const tabClass = (active: boolean) =>
    active
      ? "rounded-lg bg-white/12 px-2.5 py-1.5 text-[0.75rem] font-medium text-white"
      : "rounded-lg px-2.5 py-1.5 text-[0.75rem] text-white/55 transition hover:bg-white/6 hover:text-white/80";

  return (
    <>
      <div className="shrink-0 border-b border-white/6 px-4 py-3">
        <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Background</p>
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
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {backgroundStyle.tab === "wallpaper" && (
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

        {backgroundStyle.tab === "gradient" && (
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

        {backgroundStyle.tab === "color" && (
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

        {backgroundStyle.tab === "image" && (
          <section className="space-y-2">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              id={imageInputId}
              onChange={(event) => onSetBackgroundImage(event.currentTarget.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="w-full rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-[0.82rem] text-white/80 transition hover:bg-white/8"
              onClick={() => document.getElementById(imageInputId)?.click()}
            >
              Choose image...
            </button>
            <input
              className="w-full rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-[0.82rem] text-white outline-none"
              type="text"
              value={backgroundImageFileName || backgroundStyle.value}
              placeholder="No image selected"
              readOnly
            />
          </section>
        )}

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
        </section>

        <section className="border-t border-white/6 pt-4">
          <div className="space-y-4">
            <SliderRow label="Padding" min={0} max={120} value={padding} onChange={onSetPadding} unit="px" />
            <SliderRow
              label="Rounded corners"
              min={0}
              max={64}
              value={roundedCorners}
              onChange={onSetRoundedCorners}
              unit="px"
            />
            <SliderRow label="Inset" min={0} max={120} value={inset} onChange={onSetInset} unit="px" />
          </div>
        </section>

        <section className="border-t border-white/6 pt-4 pb-2">
          <div className="space-y-4">
            <SliderRow label="Shadow" min={0} max={100} value={shadow} onChange={onSetShadow} unit="%" />

            <details className="rounded-lg border border-white/10 bg-white/3 px-3 py-2">
              <summary className="cursor-pointer text-[0.75rem] font-medium text-white/70">Advanced shadow settings</summary>
              <div className="mt-3 space-y-3">
                <label className="flex items-center justify-between rounded-lg border border-white/10 bg-white/4 px-2.5 py-2 text-[0.76rem]">
                  <span className="text-white/72">Directional shadow</span>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[#9b88ff]"
                    checked={directionalShadow}
                    onChange={(e) => onSetDirectionalShadow(e.currentTarget.checked)}
                  />
                </label>

                <SliderRow
                  label="Shadow angle"
                  min={0}
                  max={360}
                  value={shadowAngle}
                  onChange={onSetShadowAngle}
                  unit="deg"
                />

                <SliderRow
                  label="Shadow blur"
                  min={0}
                  max={120}
                  value={shadowBlur}
                  onChange={onSetShadowBlur}
                  unit="px"
                />
              </div>
            </details>
          </div>
        </section>
      </div>
    </>
  );
}
