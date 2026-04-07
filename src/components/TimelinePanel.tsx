import { useEffect, useMemo, useRef, useState } from "react";

import type { ClickEvent, ZoomMarker, ZoomPreviewResponse } from "../types";

type TimelinePanelProps = {
  audioGain: number;
  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
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

/** Deterministic pseudo-random waveform height for bar at index i out of total */
function waveformBar(i: number): number {
  const a = Math.sin(i * 2.31 + 1.73) * 0.5 + 0.5;
  const b = Math.sin(i * 0.71 + 3.14) * 0.5 + 0.5;
  const c = Math.sin(i * 5.17 + 0.43) * 0.5 + 0.5;
  return 0.10 + ((a + b + c) / 3) * 0.82;
}

const WAVEFORM_BARS = 120;

export function TimelinePanel({
  audioGain,
  currentTimeMs,
  durationMs,
  isPlaying,
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
    <section className="shrink-0 select-none border-t border-white/6 bg-[#0c0d12] px-4 py-3 text-white">
      {/* Controls bar */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-white/55 text-sm">
          <button
            type="button"
            className="rounded-full border border-white/10 bg-white/5 p-1.5 transition hover:bg-white/10 hover:text-white"
            onClick={onTogglePlay}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <path d="M8 7h3v10H8zm5 0h3v10h-3z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <path d="m9 7 8 5-8 5z" />
              </svg>
            )}
          </button>
          <span className="tabular-nums text-[0.75rem]">
            <span className="text-white/80">{formatTime(currentTimeMs)}</span>
            <span className="text-white/30"> / {formatTime(effectiveDuration)}</span>
          </span>
        </div>

        <div className="flex items-center gap-3 text-[0.72rem] text-white/35">
          {padding !== 32 && <span>Padding {padding}</span>}
          {scalePercent !== 100 && <span>Scale {scalePercent}%</span>}
          {audioGain !== 100 && <span>Audio {audioGain}%</span>}
          {zoomPreview && <span>{zoomPreview.clickCount} zoom events</span>}
        </div>
      </div>

      {/* Timeline tracks */}
      <div ref={timelineAreaRef} className="relative space-y-1.5">
        {/* Time ruler */}
        <div className="relative h-5">
          {rulerTicks.map((ms) => (
            <div
              key={ms}
              className="absolute flex flex-col items-center"
              style={{ left: `${posPercent(ms)}%`, transform: "translateX(-50%)" }}
            >
              <div className="h-1.5 w-px bg-white/20" />
              <span className="mt-0.5 text-[0.62rem] tabular-nums text-white/30">{formatTime(ms)}</span>
            </div>
          ))}
        </div>

        {/* Amber clip track (with waveform) */}
        <div
          ref={trackRef}
          className="relative h-12 cursor-pointer overflow-hidden rounded-xl border border-[#4a3208] bg-[#12090000]"
          onPointerDown={handleTrackPointerDown}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={effectiveDuration}
          aria-valuenow={currentTimeMs}
        >
          {/* Track fill */}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#c48a14_0%,#a36708_100%)]" />

          {/* Waveform bars */}
          <div className="pointer-events-none absolute inset-0 flex items-center gap-px px-1">
            {Array.from({ length: WAVEFORM_BARS }, (_, i) => {
              const h = waveformBar(i);
              return (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-[rgba(255,255,255,0.22)]"
                  style={{ height: `${h * 100}%` }}
                />
              );
            })}
          </div>

          {/* Highlight sheen */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.12)_0%,transparent_60%)]" />

          {/* Trim region — grey out outside trim */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-black/40"
            style={{ width: `${posPercent(trimStartMs)}%` }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 bg-black/40"
            style={{ width: `${100 - posPercent(trimEndMs)}%` }}
          />

          {/* Trim handles */}
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white/60"
            style={{ left: `${posPercent(trimStartMs)}%` }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white/60"
            style={{ left: `${posPercent(trimEndMs)}%` }}
          />

          {/* Hidden range inputs for trim */}
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
                className="absolute inset-y-1 rounded-md bg-[linear-gradient(135deg,#7d5dff,#5038d8)] shadow-[0_2px_8px_rgba(125,93,255,0.35)] cursor-move"
                style={{
                  left: `${posPercent(marker.startMs)}%`,
                  width: `${Math.max(posPercent(marker.endMs) - posPercent(marker.startMs), 2)}%`,
                }}
                onPointerDown={() => setDraggingMarker({ id: marker.id, mode: "move" })}
                onClick={() => onSeek(marker.startMs)}
              >
                {/* resize handles */}
                <div
                  className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md bg-white/20"
                  onPointerDown={(e) => { e.stopPropagation(); setDraggingMarker({ id: marker.id, mode: "start" }); }}
                />
                <div
                  className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md bg-white/20"
                  onPointerDown={(e) => { e.stopPropagation(); setDraggingMarker({ id: marker.id, mode: "end" }); }}
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.6rem] font-medium text-white/80 truncate px-3">
                  {marker.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Global playhead (ruler + all tracks) */}
        <div
          className="pointer-events-none absolute inset-y-0 z-40"
          style={{ left: `${playheadPercent}%`, transform: "translateX(-50%)" }}
        >
          <button
            type="button"
            className="pointer-events-auto block h-2.5 w-2.5 cursor-ew-resize rounded-full border border-white/90 bg-[#0c0d12] shadow-[0_0_8px_rgba(255,255,255,0.45)]"
            aria-label="Drag playhead"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingPlayhead(true);
            }}
          />
          <div className="mx-auto h-[calc(100%-0.625rem)] w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.55)]" />
        </div>
      </div>

      {/* Trim scrubbers (invisible, on top) */}
      <div className="pointer-events-none absolute inset-0 opacity-0">
        <input
          className="pointer-events-auto absolute top-[3.5rem] left-0 right-0 h-3 cursor-ew-resize"
          type="range"
          min={0}
          max={Math.max(trimEndMs - 250, 0)}
          value={Math.min(trimStartMs, Math.max(trimEndMs - 250, 0))}
          onChange={(e) => onTrimStartChange(Number(e.currentTarget.value))}
        />
        <input
          className="pointer-events-auto absolute top-[3.5rem] left-0 right-0 h-3 cursor-ew-resize"
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
