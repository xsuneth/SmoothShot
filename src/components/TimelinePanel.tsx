import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { ClickEvent, ZoomMarker, ZoomPreviewResponse } from "../types";

type TimelinePanelProps = {
  audioGain: number;
  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
  isProcessing: boolean;
  previewUrl: string | null;
  padding: number;
  scalePercent: number;
  timeline: ClickEvent[];
  trimEndMs: number;
  trimStartMs: number;
  zoomPreview: ZoomPreviewResponse | null;
  onSeek: (timeMs: number) => void;
  onTogglePlay: () => void;
  zoomMarkers: ZoomMarker[];
  onMoveZoomMarker: (markerId: string, startMs: number, endMs: number) => void;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
};

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds % 1) * 10);
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}`;
  return `${seconds}.${tenths}s`;
}

const WAVEFORM_BARS = 160;
const WAVEFORM_VIEWBOX_WIDTH = 1000;
const WAVEFORM_VIEWBOX_HEIGHT = 100;

function buildWaveformPaths(samples: number[]) {
  if (samples.length < 2) {
    return { fill: "", topLine: "", bottomLine: "" };
  }

  const W = WAVEFORM_VIEWBOX_WIDTH;
  const centerY = WAVEFORM_VIEWBOX_HEIGHT / 2;
  // Max amplitude = 85 % of the half-height, leaving a small gap at top/bottom edges
  const maxAmp = centerY * 0.85;

  const topPts = samples.map((v, i) => ({
    x: (i / (samples.length - 1)) * W,
    y: centerY - Math.min(1, Math.max(0, v)) * maxAmp,
  }));
  const botPts = samples.map((v, i) => ({
    x: (i / (samples.length - 1)) * W,
    y: centerY + Math.min(1, Math.max(0, v)) * maxAmp,
  }));

  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const topLine = toPath(topPts);
  const bottomLine = toPath(botPts);
  // Closed fill: top-curve → reversed bottom-curve
  const fill = `${topLine} ${[...botPts].reverse().map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} Z`;

  return { fill, topLine, bottomLine };
}

export function TimelinePanel({
  audioGain,
  currentTimeMs,
  durationMs,
  isPlaying,
  isProcessing,
  previewUrl,
  padding,
  scalePercent,
  timeline: _timeline,
  trimEndMs,
  trimStartMs,
  zoomPreview,
  onSeek,
  onTogglePlay,
  zoomMarkers,
  onMoveZoomMarker,
  onTrimStartChange,
  onTrimEndChange,
}: TimelinePanelProps) {
  const effectiveDuration = Math.max(durationMs, trimEndMs, 1000);
  const playheadPercent = Math.min(100, Math.max(0, (currentTimeMs / effectiveDuration) * 100));
  const trackRef = useRef<HTMLDivElement>(null);
  const timelineAreaRef = useRef<HTMLDivElement>(null);
  const zoomTrackRef = useRef<HTMLDivElement>(null);
  const [draggingMarker, setDraggingMarker] = useState<{ id: string; mode: "move" | "start" | "end" } | null>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [waveformBars, setWaveformBars] = useState<number[]>(() => Array.from({ length: WAVEFORM_BARS }, () => 0));
  const waveformPaths = useMemo(() => buildWaveformPaths(waveformBars), [waveformBars]);
  const startLabel = "0.0";
  const endLabel = formatTime(effectiveDuration);

  useEffect(() => {
    let cancelled = false;
    const fallback = Array.from({ length: WAVEFORM_BARS }, () => 0);

    async function buildWaveform() {
      if (!previewUrl || isProcessing) {
        setWaveformBars(fallback);
        return;
      }

      try {
        const peaks = await invoke<number[]>("get_audio_waveform_peaks", {
          bars: WAVEFORM_BARS,
        });

        if (cancelled) return;

        if (!Array.isArray(peaks) || peaks.length === 0) {
          setWaveformBars(fallback);
          return;
        }

        const normalized = peaks.map((value) => {
          const v = Number.isFinite(value) ? value : 0;
          return 0.04 + Math.min(1, Math.max(0, v)) * 0.90;
        });
        setWaveformBars(normalized);
      } catch {
        if (!cancelled) {
          setWaveformBars(fallback);
        }
      }
    }

    void buildWaveform();

    return () => {
      cancelled = true;
    };
  }, [isProcessing, previewUrl]);

  // Build time ruler ticks at every second (capped to ~14 ticks)
  const rulerTicks = useMemo(() => {
    const totalSeconds = Math.ceil(effectiveDuration / 1000);
    const step = Math.max(1, Math.ceil(totalSeconds / 12));
    const ticks: number[] = [];
    for (let s = 0; s <= totalSeconds; s += step) {
      ticks.push(s * 1000);
    }
    return ticks;
  }, [effectiveDuration]);

  useEffect(() => {
    if (!draggingMarker) return;
    const activeDrag = draggingMarker;

    function handlePointerMove(event: PointerEvent) {
      const bounds = zoomTrackRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const marker = zoomMarkers.find((item) => item.id === activeDrag.id);
      if (!marker) return;

      const ratio = (event.clientX - bounds.left) / bounds.width;
      const pointerTime = clampTime(ratio * effectiveDuration);
      const dur = marker.endMs - marker.startMs;

      if (activeDrag.mode === "move") {
        const nextStart = clampTime(pointerTime - dur / 2);
        const nextEnd = Math.min(nextStart + dur, effectiveDuration);
        onMoveZoomMarker(marker.id, Math.max(0, nextEnd - dur), nextEnd);
        return;
      }

      if (activeDrag.mode === "start") {
        onMoveZoomMarker(marker.id, Math.min(pointerTime, marker.endMs - 250), marker.endMs);
        return;
      }

      onMoveZoomMarker(marker.id, marker.startMs, Math.max(pointerTime, marker.startMs + 250));
    }

    function handlePointerUp() {
      setDraggingMarker(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [draggingMarker, effectiveDuration, onMoveZoomMarker, zoomMarkers]);

  useEffect(() => {
    if (!isDraggingPlayhead) return;

    function handlePointerMove(event: PointerEvent) {
      const bounds = timelineAreaRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const ratio = (event.clientX - bounds.left) / bounds.width;
      onSeek(clampTime(ratio * effectiveDuration));
    }

    function handlePointerUp() {
      setIsDraggingPlayhead(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [effectiveDuration, isDraggingPlayhead, onSeek]);

  function clampTime(t: number) {
    return Math.min(Math.max(0, t), effectiveDuration);
  }

  function posPercent(ms: number) {
    return Math.min(100, Math.max(0, (ms / effectiveDuration) * 100));
  }

  function handleTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(clampTime(ratio * effectiveDuration));
  }

  return (
    <section className="shrink-0 select-none border-t border-white/6 bg-[#0a0b10] px-4 py-3 text-white">
      {/* Timeline tracks */}
      <div ref={timelineAreaRef} className="relative space-y-2">

        {/* Time ruler */}
        <div className="relative h-6">
          {/* Trim start scissors */}
          {trimStartMs > 0 && (
            <div
              className="absolute top-0 flex flex-col items-center gap-0.5"
              style={{ left: `${posPercent(trimStartMs)}%`, transform: "translateX(-50%)" }}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-amber-400/80" fill="currentColor" aria-hidden>
                <path d="M9.64 7.64c.23-.5.36-1.05.36-1.64a4 4 0 0 0-8 0 4 4 0 0 0 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14a4 4 0 0 0-4 4 4 4 0 0 0 4 4 4 4 0 0 0 4-4c0-.59-.13-1.14-.36-1.64L11 15l7 7h3v-1L9.64 7.64zM6 8a2 2 0 0 1-2-2 2 2 0 0 1 2-2 2 2 0 0 1 2 2 2 2 0 0 1-2 2zm0 12a2 2 0 0 1-2-2 2 2 0 0 1 2-2 2 2 0 0 1 2 2 2 2 0 0 1-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-7 7 2 2 7-7V3h-2z"/>
              </svg>
              <span className="text-[0.55rem] tabular-nums text-amber-400/60">{formatTime(trimStartMs)}</span>
            </div>
          )}

          {/* Trim end scissors */}
          {trimEndMs < effectiveDuration && (
            <div
              className="absolute top-0 flex flex-col items-center gap-0.5"
              style={{ left: `${posPercent(trimEndMs)}%`, transform: "translateX(-50%)" }}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-amber-400/80" fill="currentColor" aria-hidden>
                <path d="M9.64 7.64c.23-.5.36-1.05.36-1.64a4 4 0 0 0-8 0 4 4 0 0 0 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14a4 4 0 0 0-4 4 4 4 0 0 0 4 4 4 4 0 0 0 4-4c0-.59-.13-1.14-.36-1.64L11 15l7 7h3v-1L9.64 7.64zM6 8a2 2 0 0 1-2-2 2 2 0 0 1 2-2 2 2 0 0 1 2 2 2 2 0 0 1-2 2zm0 12a2 2 0 0 1-2-2 2 2 0 0 1 2-2 2 2 0 0 1 2 2 2 2 0 0 1-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-7 7 2 2 7-7V3h-2z"/>
              </svg>
              <span className="text-[0.55rem] tabular-nums text-amber-400/60">{formatTime(trimEndMs)}</span>
            </div>
          )}

          {/* Second ticks */}
          {rulerTicks.map((ms) => (
            <div
              key={ms}
              className="absolute flex flex-col items-center"
              style={{ left: `${posPercent(ms)}%`, transform: "translateX(-50%)" }}
            >
              <div className="h-1 w-px bg-white/15" />
              <span className="mt-0.5 text-[0.6rem] tabular-nums text-white/25">{formatTime(ms)}</span>
            </div>
          ))}
        </div>

        {/* Amber clip track */}
        <div
          ref={trackRef}
          className="relative h-14 cursor-pointer overflow-hidden rounded-lg"
          style={{ background: "#7a5005" }}
          onPointerDown={handleTrackPointerDown}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={effectiveDuration}
          aria-valuenow={currentTimeMs}
        >
          {/* Amber gradient base */}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#c9900e_0%,#8a5c05_100%)]" />

          {/* Centered mirrored waveform — full height */}
          <svg
            className="pointer-events-none absolute inset-0"
            width="100%"
            height="100%"
            viewBox={`0 0 ${WAVEFORM_VIEWBOX_WIDTH} ${WAVEFORM_VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {/* Filled region between top and bottom */}
            {waveformPaths.fill && (
              <path d={waveformPaths.fill} fill="rgba(255, 230, 140, 0.22)" />
            )}
            {/* Top outline */}
            {waveformPaths.topLine && (
              <path
                d={waveformPaths.topLine}
                fill="none"
                stroke="rgba(255, 230, 120, 0.85)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {/* Bottom outline (mirror) */}
            {waveformPaths.bottomLine && (
              <path
                d={waveformPaths.bottomLine}
                fill="none"
                stroke="rgba(255, 230, 120, 0.85)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>

          {/* Clip label — centered */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <div className="flex items-center gap-1 text-[0.65rem] font-semibold text-white/70">
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M7 6v12M17 6v12" />
                <path d="M2 10h3M2 14h3M19 10h3M19 14h3" />
              </svg>
              Clip
            </div>
            <span className="text-[0.58rem] tabular-nums text-white/45">
              {endLabel} &middot; 1x
            </span>
          </div>

          {/* Corner timestamps */}
          <span className="pointer-events-none absolute left-2 bottom-1.5 text-[0.55rem] tabular-nums text-white/40 leading-none">{startLabel}</span>
          <span className="pointer-events-none absolute right-2 bottom-1.5 text-[0.55rem] tabular-nums text-white/40 leading-none">{endLabel}</span>

          {/* Inner top highlight sheen */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-black/30" />

          {/* Trim region — darken outside trim */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-black/50"
            style={{ width: `${posPercent(trimStartMs)}%` }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 bg-black/50"
            style={{ width: `${100 - posPercent(trimEndMs)}%` }}
          />

          {/* Trim handles */}
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white/70"
            style={{ left: `${posPercent(trimStartMs)}%` }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white/70"
            style={{ left: `${posPercent(trimEndMs)}%` }}
          />

          {/* Seek range input (transparent, on top) */}
          <input
            className="absolute inset-0 z-30 h-full w-full cursor-pointer opacity-0"
            type="range"
            min={0}
            max={effectiveDuration}
            value={Math.min(currentTimeMs, effectiveDuration)}
            onChange={(e) => onSeek(Number(e.currentTarget.value))}
          />
        </div>

        {/* Zoom markers track */}
        {zoomMarkers.length > 0 && (
          <div ref={zoomTrackRef} className="relative h-12 overflow-hidden rounded-lg bg-[#0f0c1a]">
            {zoomMarkers.map((marker) => (
              <div
                key={marker.id}
                className="absolute inset-y-0 cursor-move rounded-lg bg-[#4a3fdb] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_2px_8px_rgba(74,63,219,0.5)]"
                style={{
                  left: `${posPercent(marker.startMs)}%`,
                  width: `${Math.max(posPercent(marker.endMs) - posPercent(marker.startMs), 2)}%`,
                }}
                onPointerDown={() => setDraggingMarker({ id: marker.id, mode: "move" })}
                onClick={() => onSeek(marker.startMs)}
              >
                {/* resize handles */}
                <div
                  className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-lg bg-white/10 hover:bg-white/20"
                  onPointerDown={(e) => { e.stopPropagation(); setDraggingMarker({ id: marker.id, mode: "start" }); }}
                />
                <div
                  className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-lg bg-white/10 hover:bg-white/20"
                  onPointerDown={(e) => { e.stopPropagation(); setDraggingMarker({ id: marker.id, mode: "end" }); }}
                />
                {/* Zoom label */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                  <div className="flex items-center gap-1 text-[0.65rem] font-semibold text-white/85">
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 6h2v2H4zM4 11h2v2H4zM4 16h2v2H4zM8 6h12M8 12h12M8 17h12" />
                    </svg>
                    Zoom
                  </div>
                  <span className="text-[0.58rem] text-white/50 truncate max-w-full px-4">
                    {marker.label ?? "Auto"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Playhead — blue circle + line, CSS transition smooths 30fps React updates */}
        <div
          className={`pointer-events-none absolute inset-y-0 z-40 ${isPlaying ? "transition-[left] duration-[85ms] ease-linear" : ""}`}
          style={{ left: `${playheadPercent}%`, transform: "translateX(-50%)" }}
        >
          {/* Circle handle */}
          <button
            type="button"
            className="pointer-events-auto relative block h-4 w-4 cursor-ew-resize"
            aria-label="Drag playhead"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingPlayhead(true);
            }}
          >
            <div className="absolute inset-0 rounded-full bg-[#5b6af5] shadow-[0_0_10px_rgba(91,106,245,0.75)]" />
            <div className="absolute inset-[3px] rounded-full bg-[#7e8cf8]/60" />
          </button>
          {/* Vertical line */}
          <div className="mx-auto mt-0 h-[calc(100%-1rem)] w-[1.5px] bg-white/85 shadow-[0_0_4px_rgba(255,255,255,0.35)]" />
        </div>
      </div>

      {/* Trim scrubbers (invisible, on top) */}
      <div className="pointer-events-none absolute inset-0 opacity-0">
        <input
          className="pointer-events-auto absolute top-14 left-0 right-0 h-3 cursor-ew-resize"
          type="range"
          min={0}
          max={Math.max(trimEndMs - 250, 0)}
          value={Math.min(trimStartMs, Math.max(trimEndMs - 250, 0))}
          onChange={(e) => onTrimStartChange(Number(e.currentTarget.value))}
        />
        <input
          className="pointer-events-auto absolute top-14 left-0 right-0 h-3 cursor-ew-resize"
          type="range"
          min={Math.min(trimStartMs + 250, effectiveDuration)}
          max={effectiveDuration}
          value={Math.max(trimEndMs, Math.min(trimStartMs + 250, effectiveDuration))}
          onChange={(e) => onTrimEndChange(Number(e.currentTarget.value))}
        />
      </div>
    </section>
  );
}
