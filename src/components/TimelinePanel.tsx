import { useEffect, useState } from "react";

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

function formatTimelineTime(timeMs: number) {
  const totalSeconds = Math.max(0, Math.round(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function TimelinePanel({
  audioGain,
  currentTimeMs,
  durationMs,
  isPlaying,
  padding,
  scalePercent,
  timeline,
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
  const ticks = Array.from({ length: 12 }, (_, index) => Math.round((effectiveDuration / 11) * index));
  const playheadPercent = Math.min(100, Math.max(0, (currentTimeMs / effectiveDuration) * 100));
  const [draggingMarker, setDraggingMarker] = useState<{ id: string; mode: "move" | "start" | "end" } | null>(null);

  useEffect(() => {
    if (!draggingMarker) {
      return;
    }

    function handlePointerUp() {
      setDraggingMarker(null);
    }

    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [draggingMarker]);

  function markerLeft(timeMs: number) {
    return Math.min(95, Math.max(5, (timeMs / effectiveDuration) * 100));
  }

  function clampTime(timeMs: number) {
    return Math.min(Math.max(0, timeMs), effectiveDuration);
  }

  return (
    <section className="shrink-0 border-t border-white/8 bg-[#08090e] px-4 py-3 text-white">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-sm text-white/88">
          1 visible timeline
        </button>
        <div className="flex flex-wrap items-center gap-3 text-sm text-white/60">
          <button type="button" className="rounded-full border border-white/10 bg-white/6 p-2 transition hover:bg-white/10" onClick={onTogglePlay}>
            {isPlaying ? (
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
                <path d="M8 7h3v10H8zm5 0h3v10h-3z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
                <path d="m9 7 8 5-8 5z" />
              </svg>
            )}
          </button>
          <span>{formatTimelineTime(currentTimeMs)} / {formatTimelineTime(effectiveDuration)}</span>
          <span>Padding {padding}</span>
          <span>Scale {scalePercent}%</span>
          <span>Audio {audioGain}%</span>
          {zoomPreview && <span>{zoomPreview.clickCount} zoom events</span>}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-12 gap-0 text-center text-xs text-white/35">
        {ticks.map((tick) => (
          <span key={tick}>{formatTimelineTime(tick)}</span>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-[16px] border border-[#3d2a05] bg-[#100b03] pb-[4.75rem]">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.04)_50%,transparent_100%)] opacity-30" />
        <input
          className="absolute inset-0 z-20 cursor-pointer opacity-0"
          type="range"
          min={0}
          max={effectiveDuration}
          value={Math.min(currentTimeMs, effectiveDuration)}
          onChange={(event) => onSeek(Number(event.currentTarget.value))}
        />
        <input
          className="absolute left-0 right-0 top-[-2px] z-30 h-3 cursor-ew-resize opacity-0"
          type="range"
          min={0}
          max={Math.max(trimEndMs - 250, 0)}
          value={Math.min(trimStartMs, Math.max(trimEndMs - 250, 0))}
          onChange={(event) => onTrimStartChange(Number(event.currentTarget.value))}
        />
        <input
          className="absolute left-0 right-0 top-[-2px] z-30 h-3 cursor-ew-resize opacity-0"
          type="range"
          min={Math.min(trimStartMs + 250, effectiveDuration)}
          max={effectiveDuration}
          value={Math.max(trimEndMs, Math.min(trimStartMs + 250, effectiveDuration))}
          onChange={(event) => onTrimEndChange(Number(event.currentTarget.value))}
        />
        <div className="relative h-[42px] bg-[linear-gradient(180deg,#d79b1f,#b87907)]">
          <div className="absolute inset-y-0 left-[38%] w-20 bg-[rgba(255,255,255,0.08)] blur-md" />
          <div className="absolute inset-y-0 left-[62%] w-16 bg-[rgba(255,255,255,0.06)] blur-md" />
          <div
            className="absolute inset-y-0 left-0 bg-[rgba(255,255,255,0.12)]"
            style={{ width: `${playheadPercent}%` }}
          />
          <div
            className="absolute top-0 bottom-0 z-10 w-[2px] bg-[#8f5dff]"
            style={{ left: `${playheadPercent}%` }}
          />
          <div
            className="absolute top-0 bottom-0 z-10 border-l-2 border-dashed border-white/35"
            style={{ left: `${markerLeft(trimStartMs)}%` }}
          />
          <div
            className="absolute top-0 bottom-0 z-10 border-l-2 border-dashed border-white/35"
            style={{ left: `${markerLeft(trimEndMs)}%` }}
          />
          {zoomMarkers.map((marker) => (
            <div
              key={marker.id}
              className="absolute bottom-3 z-10 flex h-[54px] items-end"
              style={{
                left: `${(marker.startMs / effectiveDuration) * 100}%`,
                width: `${Math.max(((marker.endMs - marker.startMs) / effectiveDuration) * 100, 4)}%`,
              }}
              onPointerMove={(event) => {
                if (!draggingMarker || draggingMarker.id !== marker.id) {
                  return;
                }

                const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
                if (!bounds) {
                  return;
                }

                const ratio = (event.clientX - bounds.left) / bounds.width;
                const pointerTime = clampTime(ratio * effectiveDuration);
                const markerDuration = marker.endMs - marker.startMs;

                if (draggingMarker.mode === "move") {
                  const centeredStart = clampTime(pointerTime - markerDuration / 2);
                  const nextEnd = Math.min(centeredStart + markerDuration, effectiveDuration);
                  const nextStart = Math.max(0, nextEnd - markerDuration);
                  onMoveZoomMarker(marker.id, nextStart, nextEnd);
                  return;
                }

                if (draggingMarker.mode === "start") {
                  onMoveZoomMarker(marker.id, Math.min(pointerTime, marker.endMs - 250), marker.endMs);
                  return;
                }

                onMoveZoomMarker(marker.id, marker.startMs, Math.max(pointerTime, marker.startMs + 250));
              }}
              onClick={() => onSeek(marker.startMs)}
            >
              <button
                type="button"
                className="absolute inset-0 rounded-xl bg-[linear-gradient(180deg,#7d5dff,#5a38e6)] px-4 py-2 text-xs font-medium text-white shadow-[0_12px_24px_rgba(90,56,230,0.35)]"
                onPointerDown={() => setDraggingMarker({ id: marker.id, mode: "move" })}
              >
                {marker.label}
              </button>
              <button
                type="button"
                className="absolute bottom-0 left-0 top-0 w-2 cursor-ew-resize rounded-l-xl bg-white/20"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setDraggingMarker({ id: marker.id, mode: "start" });
                }}
                aria-label={`Adjust ${marker.label} start`}
              />
              <button
                type="button"
                className="absolute bottom-0 right-0 top-0 w-2 cursor-ew-resize rounded-r-xl bg-white/20"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setDraggingMarker({ id: marker.id, mode: "end" });
                }}
                aria-label={`Adjust ${marker.label} end`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 text-sm text-white/55">
        Trim {trimStartMs}ms to {trimEndMs}ms{timeline.length > 0 ? ` | ${timeline.length} click events` : ""}
      </div>
    </section>
  );
}
