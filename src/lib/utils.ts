import { convertFileSrc } from "@tauri-apps/api/core";

import type { AudioConfig, BackgroundStyle, ClickEvent, DisplayDescriptor, FrameMetadata, InputDeviceOption, ZoomMarker } from "../types";

const DISPLAY_CARD_WIDTH = 248;
const DISPLAY_CARD_HEIGHT = 100;
const DISPLAY_PICKER_GRID_GAP = 8;
const DISPLAY_PICKER_FRAME_WIDTH = 16;
const DISPLAY_PICKER_FRAME_HEIGHT = 16;

export function buildAudioConfig(systemAudioEnabled: boolean, micEnabled: boolean): AudioConfig {
  return {
    systemAudioEnabled,
    micEnabled,
    systemAudioGain: 1.0,
    micGain: 1.0,
  };
}

export function resolveDisplayLabel(displays: DisplayDescriptor[], selection: string): string {
  const selectedDisplay = displays.find((display) => String(display.index) === selection);
  return selectedDisplay
    ? `${selectedDisplay.isPrimary ? "Primary" : `Display ${selectedDisplay.index + 1}`} ${selectedDisplay.width}x${selectedDisplay.height}`
    : "Display not selected";
}

export function resolveDeviceLabel(devices: InputDeviceOption[], selectedId: string | null, fallback: string): string {
  return devices.find((device) => device.id === selectedId)?.name ?? devices[0]?.name ?? fallback;
}

export function getDisplayPickerSize(displayCount: number) {
  const safeCount = Math.max(displayCount, 1);
  const columns = safeCount === 1 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(safeCount / 2));
  return {
    width: columns * DISPLAY_CARD_WIDTH + (columns - 1) * DISPLAY_PICKER_GRID_GAP + DISPLAY_PICKER_FRAME_WIDTH,
    height: rows * DISPLAY_CARD_HEIGHT + (rows - 1) * DISPLAY_PICKER_GRID_GAP + DISPLAY_PICKER_FRAME_HEIGHT,
  };
}

export function clickEventsToMarkers(clicks: ClickEvent[], durationMs: number): ZoomMarker[] {
  const zoomDurationMs = 2000;
  const sortedClicks = [...clicks].sort((a, b) => a.timestampMs - b.timestampMs);
  const sessionEndMs = durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY;

  return sortedClicks.map((event, index) => {
    const startMs = Math.max(0, event.timestampMs);
    const endMs = Math.min(startMs + zoomDurationMs, sessionEndMs);

    return {
      id: `zoom-click-${index}-${Math.round(startMs)}`,
      label: "Zoom",
      startMs,
      endMs: Math.max(startMs + 250, endMs),
    };
  });
}

export function normalizeSessionTiming(clicks: ClickEvent[], frameTrack: FrameMetadata[]) {
  const firstFrameTime = frameTrack[0]?.timestampMs ?? Number.NaN;
  const firstClickTime = clicks[0]?.timestampMs ?? Number.POSITIVE_INFINITY;
  // Anchor editor time to frame/video timeline first so cursor stays synced.
  const zeroPoint = Number.isFinite(firstFrameTime) ? firstFrameTime : firstClickTime;

  if (!Number.isFinite(zeroPoint) || zeroPoint <= 0) {
    return { clicks, frameTrack };
  }

  return {
    clicks: clicks.map((event) => ({
      ...event,
      timestampMs: Math.max(0, event.timestampMs - zeroPoint),
    })),
    frameTrack: frameTrack.map((frame) => ({
      ...frame,
      timestampMs: Math.max(0, frame.timestampMs - zeroPoint),
    })),
  };
}

export function toLocalFileUrl(path: string) {
  return convertFileSrc(path);
}

export function nextBackgroundValue(tab: BackgroundStyle["tab"]): string {
  if (tab === "wallpaper") {
    return "/wallpapers/wallpaper1.jpg";
  }

  if (tab === "gradient") {
    return "aurora";
  }

  if (tab === "color") {
    return "midnight";
  }

  return "";
}
