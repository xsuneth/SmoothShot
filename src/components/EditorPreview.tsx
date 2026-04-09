import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Player } from "@remotion/player";
import type { PlayerRef } from "@remotion/player";
import { RemotionPreviewComposition } from "./RemotionPreviewComposition";

import type {
  BackgroundStyle,
  CameraCorner,
  FrameMetadata,
  GpuInitStatus,
  PreviewToolPanel,
  PreviewFrameResponse,
  RecordingStatus,
  ZoomMarker,
} from "../types";
import { backgroundCss } from "../lib/theme";

// ── Cursor shape renderer ─────────────────────────────────────────────────────

const SHADOW = "drop-shadow(0 3px 6px rgba(0,0,0,0.55))";
const REMOTION_FPS = 60;

function CursorIcon({ type }: { type: string }) {
  const base = "h-[clamp(18px,3.2cqh,36px)] w-[clamp(18px,3.2cqh,36px)]";
  switch (type) {
    case "text":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" style={{ filter: SHADOW }}>
          <line x1="12" y1="4" x2="12" y2="20" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <line x1="9" y1="4" x2="15" y2="4" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <line x1="9" y1="20" x2="15" y2="20" stroke="white" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="4" x2="12" y2="20" stroke="rgba(12,14,20,0.7)" strokeWidth="3.5" strokeLinecap="round" style={{ mixBlendMode: "multiply" }} />
        </svg>
      );
    case "pointer":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" style={{ filter: SHADOW }}>
          <path d="M8 2v12l2.5-2.5 1.5 4 2-0.7-1.5-4H16z" fill="white" stroke="rgba(12,14,20,0.85)" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case "crosshair":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" style={{ filter: SHADOW }}>
          <circle cx="12" cy="12" r="3" stroke="white" strokeWidth="1.5" />
          <line x1="12" y1="2" x2="12" y2="8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="12" y1="16" x2="12" y2="22" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="2" y1="12" x2="8" y2="12" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="16" y1="12" x2="22" y2="12" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "move":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" style={{ filter: SHADOW }}>
          <path d="M12 2l-2 3h4zM12 22l2-3H10zM2 12l3 2v-4zM22 12l-3-2v4zM12 2v20M2 12h20" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="white" />
        </svg>
      );
    case "ns-resize":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" style={{ filter: SHADOW }}>
          <path d="M12 3l-3 4h6zM12 21l3-4H9zM12 3v18" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "ew-resize":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" style={{ filter: SHADOW }}>
          <path d="M3 12l4-3v6zM21 12l-4 3v-6zM3 12h18" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "nwse-resize":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" style={{ filter: SHADOW }}>
          <path d="M4 4h6M4 4v6M20 20h-6M20 20v-6M4 4l16 16" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "nesw-resize":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" style={{ filter: SHADOW }}>
          <path d="M20 4h-6M20 4v6M4 20h6M4 20v-6M20 4L4 20" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "not-allowed":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" style={{ filter: SHADOW }}>
          <circle cx="12" cy="12" r="9" stroke="white" strokeWidth="1.5" />
          <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "wait":
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" style={{ filter: SHADOW }}>
          <path d="M7 2h10M7 22h10M8 2v4l3 3-3 4v4M16 2v4l-3 3 3 4v4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "none":
      return null;
    default:
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" style={{ filter: SHADOW }}>
          <path
            d="M6 3.5 16.5 14l-4.3.9 1.9 5.6-2.7.9-1.9-5.5-3.8 2L6 3.5Z"
            fill="white"
            stroke="rgba(12,14,20,0.85)"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

type EditorPreviewProps = {
  activeToolPanel: PreviewToolPanel;
  backgroundStyle: BackgroundStyle;
  cameraUrl?: string | null;
  cameraCorner: CameraCorner;
  cameraMirrored: boolean;
  cameraRoundness: number;
  currentTimeMs: number;
  cursorTrack: FrameMetadata[];
  cursorScale: number;
  gpuStatus: GpuInitStatus | null;
  isPlaying: boolean;
  isMuted: boolean;
  isProcessing?: boolean;
  maxZoom: number;
  previewUrl: string | null;
  padding: number;
  roundedCorners: number;
  inset: number;
  shadow: number;
  directionalShadow: boolean;
  shadowAngle: number;
  shadowBlur: number;
  scalePercent: number;
  sessionDurationMs: number;
  showCursor: boolean;
  status: RecordingStatus;
  zoomInMs: number;
  zoomMarkers: ZoomMarker[];
  zoomOutMs: number;
  onDurationChange: (durationMs: number) => void;
  onSetActiveToolPanel: (panel: PreviewToolPanel) => void;
  onPlaybackEnded: () => void;
  onSeekBy: (deltaMs: number) => void;
  onTimeChange: (timeMs: number) => void;
  onToggleMute: () => void;
  onTogglePlay: () => void;
  onVideoError?: (message: string) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function easeInOut(progress: number) {
  return -(Math.cos(Math.PI * progress) - 1) / 2;
}

function interpolateCursor(cursorTrack: FrameMetadata[], currentTimeMs: number) {
  if (cursorTrack.length === 0) return null;
  if (cursorTrack.length === 1 || currentTimeMs <= cursorTrack[0].timestampMs) return cursorTrack[0];

  const lastFrame = cursorTrack[cursorTrack.length - 1];
  if (currentTimeMs >= lastFrame.timestampMs) return lastFrame;

  let leftIndex = 0;
  while (leftIndex + 1 < cursorTrack.length && cursorTrack[leftIndex + 1].timestampMs <= currentTimeMs) {
    leftIndex += 1;
  }

  const left = cursorTrack[leftIndex];
  const right = cursorTrack[Math.min(leftIndex + 1, cursorTrack.length - 1)];
  const span = Math.max(right.timestampMs - left.timestampMs, 1);
  const blend = clamp((currentTimeMs - left.timestampMs) / span, 0, 1);

  return {
    ...left,
    cursorX: Math.round(left.cursorX + (right.cursorX - left.cursorX) * blend),
    cursorY: Math.round(left.cursorY + (right.cursorY - left.cursorY) * blend),
  };
}

function liveZoomState(
  zoomMarkers: ZoomMarker[],
  currentTimeMs: number,
  zoomInMs: number,
  zoomOutMs: number,
  maxZoom: number,
) {
  const sorted = [...zoomMarkers].sort((a, b) => a.startMs - b.startMs);
  let bestZoom = 1;
  let bestMarker: ZoomMarker | null = null;

  for (const marker of sorted) {
    if (currentTimeMs < marker.startMs || currentTimeMs > marker.endMs) {
      continue;
    }

    const entryDelta = currentTimeMs - marker.startMs;
    const exitDelta = marker.endMs - currentTimeMs;
    let zoom = 1;

    if (entryDelta <= zoomInMs) {
      zoom = 1 + (maxZoom - 1) * easeInOut(entryDelta / Math.max(zoomInMs, 1));
    } else if (exitDelta <= zoomOutMs) {
      zoom = 1 + (maxZoom - 1) * easeInOut(exitDelta / Math.max(zoomOutMs, 1));
    } else {
      zoom = maxZoom;
    }

    if (zoom > bestZoom) {
      bestZoom = zoom;
      bestMarker = marker;
    }
  }

  return { zoom: bestZoom, marker: bestMarker };
}

export function EditorPreview({
  activeToolPanel,
  backgroundStyle,
  cameraUrl,
  cameraCorner,
  cameraMirrored,
  cameraRoundness,
  currentTimeMs,
  cursorTrack,
  cursorScale,
  gpuStatus,
  isPlaying,
  isMuted,
  isProcessing,
  maxZoom,
  previewUrl,
  padding,
  roundedCorners,
  inset,
  shadow,
  directionalShadow,
  shadowAngle,
  shadowBlur,
  scalePercent,
  sessionDurationMs,
  showCursor,
  status,
  zoomInMs,
  zoomMarkers,
  zoomOutMs,
  onDurationChange,
  onSetActiveToolPanel,
  onPlaybackEnded,
  onSeekBy,
  onTimeChange,
  onToggleMute,
  onTogglePlay,
  onVideoError,
}: EditorPreviewProps) {
  const playerRef = useRef<PlayerRef | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentTimeRef = useRef(currentTimeMs);
  const lastEmittedTimeRef = useRef(currentTimeMs);
  const onTimeChangeRef = useRef(onTimeChange);
  const onPlaybackEndedRef = useRef(onPlaybackEnded);
  const requestSequenceRef = useRef(0);
  const [previewFrame, setPreviewFrame] = useState<PreviewFrameResponse | null>(null);
  const [isLoadingFrame, setIsLoadingFrame] = useState(false);
  const [mediaDurationMs, setMediaDurationMs] = useState(0);
  const [mediaDimensions, setMediaDimensions] = useState<{ width: number; height: number } | null>(null);
  const stageBackground = backgroundCss(backgroundStyle);

  const orderedCursorTrack = useMemo(
    () => [...cursorTrack].sort((left, right) => left.timestampMs - right.timestampMs),
    [cursorTrack],
  );

  const cursorTimelineRange = useMemo(() => {
    if (orderedCursorTrack.length === 0) return null;
    const firstTimestampMs = orderedCursorTrack[0].timestampMs;
    const lastTimestampMs = orderedCursorTrack[orderedCursorTrack.length - 1].timestampMs;
    return {
      firstTimestampMs,
      spanMs: Math.max(1, lastTimestampMs - firstTimestampMs),
    };
  }, [orderedCursorTrack]);

  const playbackDurationMs = Math.max(
    1,
    previewUrl && mediaDurationMs > 0 ? mediaDurationMs : sessionDurationMs,
  );
  const durationInFrames = Math.max(1, Math.ceil((playbackDurationMs / 1000) * REMOTION_FPS));
  const timeMsToFrame = useCallback((timeMs: number) => {
    if (durationInFrames <= 1 || playbackDurationMs <= 0) return 0;
    const progress = clamp(timeMs / playbackDurationMs, 0, 1);
    return Math.round(progress * (durationInFrames - 1));
  }, [durationInFrames, playbackDurationMs]);

  const cursorTimelineTimeMs = useMemo(() => {
    if (!cursorTimelineRange) return currentTimeMs;
    const clampedPlaybackTime = clamp(currentTimeMs, 0, playbackDurationMs);
    const progress = clampedPlaybackTime / playbackDurationMs;
    return cursorTimelineRange.firstTimestampMs + cursorTimelineRange.spanMs * progress;
  }, [cursorTimelineRange, currentTimeMs, playbackDurationMs]);

  const activeCursor = useMemo(
    () => interpolateCursor(orderedCursorTrack, cursorTimelineTimeMs),
    [orderedCursorTrack, cursorTimelineTimeMs],
  );
  // Keep cursor coordinates mapped to a stable source-space size.
  const cursorSourceWidth = orderedCursorTrack[0]?.width ?? mediaDimensions?.width ?? previewFrame?.width ?? 1920;
  const cursorSourceHeight = orderedCursorTrack[0]?.height ?? mediaDimensions?.height ?? previewFrame?.height ?? 1080;
  const sourceWidth = mediaDimensions?.width ?? previewFrame?.width ?? cursorSourceWidth;
  const sourceHeight = mediaDimensions?.height ?? previewFrame?.height ?? cursorSourceHeight;
  const compositionWidth = Math.max(1, Math.round(mediaDimensions?.width ?? previewFrame?.width ?? sourceWidth));
  const compositionHeight = Math.max(1, Math.round(mediaDimensions?.height ?? previewFrame?.height ?? sourceHeight));
  const previewAspectRatio =
    mediaDimensions?.width && mediaDimensions?.height
      ? mediaDimensions.width / mediaDimensions.height
      : previewFrame?.width && previewFrame?.height
        ? previewFrame.width / previewFrame.height
        : 16 / 9;
  const cursorInBounds =
    Boolean(activeCursor) &&
    activeCursor!.cursorX >= 0 &&
    activeCursor!.cursorX < sourceWidth &&
    activeCursor!.cursorY >= 0 &&
    activeCursor!.cursorY < sourceHeight &&
    activeCursor!.cursorType !== "none";
  const cursorLeft = activeCursor ? (activeCursor.cursorX / cursorSourceWidth) * 100 : 50;
  const cursorTop = activeCursor ? (activeCursor.cursorY / cursorSourceHeight) * 100 : 50;

  const { zoom, marker: zoomFocusMarker } = useMemo(
    () => liveZoomState(zoomMarkers, currentTimeMs, zoomInMs, zoomOutMs, maxZoom),
    [zoomMarkers, currentTimeMs, zoomInMs, zoomOutMs, maxZoom],
  );

  const focusXPercent = zoomFocusMarker && activeCursor && cursorInBounds
    ? clamp((activeCursor.cursorX / cursorSourceWidth) * 100, 5, 95)
    : 50;
  const focusYPercent = zoomFocusMarker && activeCursor && cursorInBounds
    ? clamp((activeCursor.cursorY / cursorSourceHeight) * 100, 5, 95)
    : 50;
  const translateX = (50 - focusXPercent) * (zoom - 1);
  const translateY = (50 - focusYPercent) * (zoom - 1);
  const effectiveInset = Math.max(0, Math.min(220, padding + inset));
  const compositionInsetPx = Math.round(clamp(effectiveInset, 0, Math.min(compositionWidth, compositionHeight) * 0.35));
  const cameraInsetPx = Math.round(clamp(Math.min(compositionWidth, compositionHeight) * 0.03, 12, 56));
  const cameraWidthPx = Math.round(clamp(compositionWidth * 0.18, 120, 360));
  const shadowOpacity = Math.min(1, Math.max(0, shadow / 100));
  const shadowDistance = directionalShadow ? 28 : 0;
  const shadowRadians = (shadowAngle * Math.PI) / 180;
  const shadowX = Math.round(Math.cos(shadowRadians) * shadowDistance);
  const shadowY = Math.round(Math.sin(shadowRadians) * shadowDistance);
  const frameShadow = directionalShadow
    ? `${shadowX}px ${shadowY}px ${shadowBlur}px rgba(0,0,0,${(0.85 * shadowOpacity).toFixed(3)})`
    : `0 16px ${shadowBlur}px rgba(0,0,0,${(0.85 * shadowOpacity).toFixed(3)})`;
  useEffect(() => {
    currentTimeRef.current = currentTimeMs;
    if (!isPlaying) {
      lastEmittedTimeRef.current = currentTimeMs;
    }
  }, [currentTimeMs, isPlaying]);

  useEffect(() => {
    onTimeChangeRef.current = onTimeChange;
  }, [onTimeChange]);

  useEffect(() => {
    onPlaybackEndedRef.current = onPlaybackEnded;
  }, [onPlaybackEnded]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !previewUrl) return;
    if (isPlaying) return;

    const targetFrame = timeMsToFrame(currentTimeMs);
    if (Math.abs(player.getCurrentFrame() - targetFrame) > 1) {
      player.seekTo(targetFrame);
    }
  }, [currentTimeMs, durationInFrames, isPlaying, playbackDurationMs, previewUrl]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !previewUrl) return;

    if (isMuted) {
      player.mute();
    } else {
      player.unmute();
    }
  }, [isMuted, previewUrl]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !previewUrl) return;

    if (isPlaying) {
      player.play();
    } else {
      player.pause();
    }
  }, [isPlaying, previewUrl]);

  // Directly control the native <video> element so Remotion's internal media-sync
  // mechanism (useMediaPlayback) cannot interfere with playback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewUrl) return;
    if (isPlaying) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying, previewUrl]);

  // Seek the native video when paused and the playhead moves (e.g. user scrubs).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewUrl || isPlaying) return;
    const targetSec = currentTimeMs / 1000;
    if (Math.abs(video.currentTime - targetSec) > 0.05) {
      video.currentTime = targetSec;
    }
  }, [currentTimeMs, isPlaying, previewUrl]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !previewUrl) return;
    const onEnded = () => { onPlaybackEndedRef.current(); };
    player.addEventListener("ended", onEnded);
    return () => { player.removeEventListener("ended", onEnded); };
  }, [previewUrl]);

  // Drive currentTimeMs from the video's exact presentation time.
  // requestVideoFrameCallback fires once per displayed frame with the real mediaTime,
  // giving perfect cursor/zoom sync. Falls back to rAF + video.currentTime polling
  // on platforms that don't support rVFC (older WebKit).
  useEffect(() => {
    if (!isPlaying || !previewUrl) return;
    const video = videoRef.current;
    if (!video) return;

    let active = true;

    if ("requestVideoFrameCallback" in video) {
      let callbackId: number;

      const onFrame = (
        _: DOMHighResTimeStamp,
        metadata: VideoFrameCallbackMetadata,
      ) => {
        if (!active) return;
        const nextTimeMs = clamp(metadata.mediaTime * 1000, 0, playbackDurationMs);
        if (nextTimeMs >= lastEmittedTimeRef.current + 4) {
          lastEmittedTimeRef.current = nextTimeMs;
          onTimeChangeRef.current(nextTimeMs);
        }
        callbackId = video.requestVideoFrameCallback(onFrame);
      };

      callbackId = video.requestVideoFrameCallback(onFrame);
      return () => {
        active = false;
        video.cancelVideoFrameCallback(callbackId);
      };
    }

    // Fallback: poll video.currentTime each animation frame.
    // Re-read the ref to avoid TypeScript's "never" narrowing after the `in` branch above.
    const videoEl = videoRef.current!;
    let rafId: number;
    const poll = () => {
      if (!active) return;
      const nextTimeMs = clamp(videoEl.currentTime * 1000, 0, playbackDurationMs);
      if (nextTimeMs >= lastEmittedTimeRef.current + 4) {
        lastEmittedTimeRef.current = nextTimeMs;
        onTimeChangeRef.current(nextTimeMs);
      }
      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
  }, [isPlaying, previewUrl, playbackDurationMs]);

  // Fallback canvas-based frame preview (no video file yet).
  useEffect(() => {
    if (previewUrl || sessionDurationMs <= 0) return;

    let cancelled = false;

    const fetchFrame = async (timeMs: number) => {
      const requestId = ++requestSequenceRef.current;
      setIsLoadingFrame(true);

      try {
        const frame = await invoke<PreviewFrameResponse | null>("get_preview_frame", {
          timeMs: Math.round(timeMs),
        });

        if (cancelled || requestId !== requestSequenceRef.current) return;

        setPreviewFrame(frame);
        if (frame) onDurationChange(sessionDurationMs);
      } catch {
        if (!cancelled && requestId === requestSequenceRef.current) {
          setPreviewFrame(null);
        }
      } finally {
        if (!cancelled && requestId === requestSequenceRef.current) {
          setIsLoadingFrame(false);
        }
      }
    };

    if (!isPlaying) {
      void fetchFrame(currentTimeMs);
      return () => { cancelled = true; };
    }

    void fetchFrame(currentTimeRef.current);
    const intervalId = window.setInterval(() => {
      void fetchFrame(currentTimeRef.current);
    }, 50);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentTimeMs, isPlaying, onDurationChange, previewUrl, sessionDurationMs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewFrame) return;

    const width = Math.max(0, Math.floor(previewFrame.width));
    const height = Math.max(0, Math.floor(previewFrame.height));
    if (width === 0 || height === 0) return;

    const expectedLength = width * height * 4;
    const rgba = previewFrame.pixelsRgba ?? [];
    if (rgba.length < expectedLength) {
      // Some capture paths can return metadata before pixel bytes are ready.
      // Skip drawing this frame to avoid ImageData construction errors.
      return;
    }

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return;

    const data = new Uint8ClampedArray(rgba.slice(0, expectedLength));
    context.putImageData(new ImageData(data, width, height), 0, 0);
  }, [previewFrame]);

  useEffect(() => {
    if (previewUrl) {
      setMediaDimensions(null);
      setMediaDurationMs(0);
    }
  }, [previewUrl]);

  return (
    <article className="grid min-h-0 grid-rows-[auto_1fr_auto] rounded-r-[18px] bg-[#05060b]">
      <div className="flex h-12 items-center justify-center gap-6 border-b border-white/6 text-sm text-white/82">
        <button type="button" className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 transition hover:bg-white/6">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="4.5" y="5.5" width="15" height="13" rx="2" />
            <path d="M8 9h8M8 13h5" />
          </svg>
          Auto
        </button>
        <button type="button" className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 transition hover:bg-white/6">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 7h10v10H4zM10 4h10v10" />
          </svg>
          Crop
        </button>
        <button type="button" className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 transition hover:bg-white/6">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="4.5" y="7.5" width="15" height="9" rx="4.5" />
            <circle cx="9" cy="12" r="2.5" fill="currentColor" stroke="none" />
          </svg>
          Mask
        </button>
      </div>

      <div className="grid min-h-0 grid-cols-[1fr_44px]">
        <div className="flex min-h-0 items-center justify-center p-3" style={{ containerType: "size" }}>
          <div
            className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-[18px] shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition-all duration-200"
            style={{
              background: stageBackground,
              aspectRatio: previewAspectRatio,
              width: `min(100cqw, calc(100cqh * ${previewAspectRatio}))`,
              containerType: "size",
            }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%)]" />
            <div
              className="relative z-10 shrink-0 overflow-visible border border-white/10 bg-black/40 transition-transform duration-200"
              style={{
                aspectRatio: previewAspectRatio,
                width: `min(100cqw, calc(100cqh * ${previewAspectRatio}))`,
                borderRadius: `${roundedCorners}px`,
                boxShadow: frameShadow,
                transform: `scale(${scalePercent / 100})`,
              }}
            >
              <Player
                ref={playerRef}
                component={RemotionPreviewComposition}
                durationInFrames={durationInFrames}
                compositionWidth={compositionWidth}
                compositionHeight={compositionHeight}
                fps={REMOTION_FPS}
                controls={false}
                autoPlay={false}
                loop={false}
                clickToPlay={false}
                acknowledgeRemotionLicense
                style={{ width: "100%", height: "100%" }}
                inputProps={{
                  stageBackground,
                  backgroundBlur: backgroundStyle.blur,
                  translateX,
                  translateY,
                  zoom,
                  previewUrl,
                  videoRef,
                  canvasRef,
                  hasPreviewFrame: Boolean(previewFrame),
                  isLoadingFrame,
                  isMuted,
                  contentPaddingPx: compositionInsetPx,
                  onLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement, Event>) => {
                    const durationMs = Number.isFinite(e.currentTarget.duration)
                      ? e.currentTarget.duration * 1000
                      : 0;
                    setMediaDurationMs(durationMs);
                    onDurationChange(durationMs);
                    if (e.currentTarget.videoWidth > 0 && e.currentTarget.videoHeight > 0) {
                      setMediaDimensions({
                        width: e.currentTarget.videoWidth,
                        height: e.currentTarget.videoHeight,
                      });
                    }
                  },
                  onPlaying: () => {},
                  onStalled: () => {
                    // In Player mode, stalled events can be transient during buffering.
                    // Do not remount or seek here to avoid playhead jumps.
                  },
                  onError: () => {
                    const video = videoRef.current;
                    const code = video?.error?.code;
                    const reason =
                      code === MediaError.MEDIA_ERR_ABORTED ? "aborted" :
                      code === MediaError.MEDIA_ERR_NETWORK ? "network" :
                      code === MediaError.MEDIA_ERR_DECODE ? "decode" :
                      code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? "unsupported-source" :
                      "unknown";
                    const details = video?.error?.message ?? "video error";
                    onVideoError?.(`Could not load preview video (${reason}): ${previewUrl} (${details})`);
                    onPlaybackEnded();
                  },
                  cursorOverlay: showCursor && activeCursor && cursorInBounds ? (
                    <div
                      className="pointer-events-none absolute z-20"
                      style={{
                        left: `${cursorLeft}%`,
                        top: `${cursorTop}%`,
                        transform: `translate(-18%, -12%) scale(${cursorScale / 100})`,
                        transformOrigin: "0 0",
                      }}
                    >
                      <CursorIcon type={activeCursor.cursorType ?? "default"} />
                    </div>
                  ) : null,
                  cameraUrl,
                  cameraCorner,
                  cameraInsetPx,
                  cameraWidthPx,
                  cameraRoundness,
                  cameraMirrored,
                }}
              />

            </div>

            {/* Processing overlay — shown while FFmpeg is finalizing after stop */}
            {isProcessing && (
              <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 rounded-[18px] bg-[rgba(8,9,15,0.88)]">
                <p className="text-sm font-medium tracking-wide text-white/70">Finalizing recording</p>
                {/* Indeterminate progress bar */}
                <div className="relative h-1 w-48 overflow-hidden rounded-full bg-white/10">
                  <div className="absolute inset-y-0 w-1/2 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-full bg-linear-to-r from-transparent via-white/60 to-transparent" />
                </div>
                <p className="text-xs text-white/35">This may take a moment for longer recordings</p>
              </div>
            )}
          </div>
        </div>

        {/* Tool sidebar */}
        <div className="flex flex-col items-center gap-1 border-l border-white/6 py-4 text-white/45">
          {[
            {
              title: "Background",
              icon: (
                <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z" />
              ),
            },
            {
              title: "Cursor",
              icon: (
                <path d="M6 3.5 16.5 14l-4.3.9 1.9 5.6-2.7.9-1.9-5.5-3.8 2L6 3.5Z" />
              ),
            },
            {
              title: "Camera",
              icon: (
                <path d="M15 10l4.553-2.277A1 1 0 0121 8.649v6.702a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              ),
            },
            {
              title: "Caption",
              icon: (
                <>
                  <rect x="4.5" y="6" width="15" height="10" rx="2" />
                  <path d="M8 11h8M8 14h5" />
                </>
              ),
            },
            {
              title: "Audio",
              icon: (
                <>
                  <path d="M12 4a2.5 2.5 0 0 1 2.5 2.5V12A2.5 2.5 0 0 1 12 14.5 2.5 2.5 0 0 1 9.5 12V6.5A2.5 2.5 0 0 1 12 4z" />
                  <path d="M7 11.5a5 5 0 0 0 10 0M12 16.5V20" />
                </>
              ),
            },
          ].map(({ title, icon }) => (
            <button
              key={title}
              type="button"
              title={title}
              className={`rounded-lg p-2 transition hover:bg-white/6 hover:text-white/90 ${activeToolPanel === title ? "bg-white/10 text-white" : ""}`}
              onClick={() => onSetActiveToolPanel(title as PreviewToolPanel)}
            >
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {icon}
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 border-t border-white/6 px-4 py-3 text-white/78">
        <button type="button" className="rounded-full p-2 transition hover:bg-white/6" onClick={() => onSeekBy(-5000)}>
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M16 7l-6 5 6 5V7ZM8 7v10" />
          </svg>
        </button>
        <button type="button" className="rounded-full border border-white/12 bg-white/6 p-2 transition hover:bg-white/10" onClick={onTogglePlay}>
          {isPlaying ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M8 7h3v10H8zm5 0h3v10h-3z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="m9 7 8 5-8 5z" />
            </svg>
          )}
        </button>
        <button type="button" className="rounded-full p-2 transition hover:bg-white/6" onClick={() => onSeekBy(5000)}>
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M8 7l6 5-6 5V7Zm8 0v10" />
          </svg>
        </button>
        <button type="button" className="rounded-full p-2 transition hover:bg-white/6" onClick={onToggleMute} aria-label={isMuted ? "Unmute preview" : "Mute preview"}>
          {isMuted ? (
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 10h4l5-4v12l-5-4H5z" />
              <path d="M4 4l16 16" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 10h4l5-4v12l-5-4H5z" />
              <path d="M18 9a4 4 0 0 1 0 6M16 7a7 7 0 0 1 0 10" />
            </svg>
          )}
        </button>

        <div className="mx-2 h-5 w-px bg-white/10" />

        <span className="rounded-full border border-white/10 px-3 py-1 text-[0.72rem] text-white/72">
          {(currentTimeMs / 1000).toFixed(2)} / {(sessionDurationMs / 1000).toFixed(2)}s
        </span>
        <span className="rounded-full border border-white/10 px-3 py-1 text-[0.72rem] text-white/72">
          {status.framesCaptured.toLocaleString()} frames
        </span>
        <span className="rounded-full border border-white/10 px-3 py-1 text-[0.72rem] text-white/72">
          {status.clicksDetected.toLocaleString()} clicks
        </span>
        {gpuStatus && (
          <span className="rounded-full border border-white/10 px-3 py-1 text-[0.72rem] text-white/72">
            GPU {gpuStatus.backend ?? "unknown"}
          </span>
        )}
      </div>
    </article>
  );
}
