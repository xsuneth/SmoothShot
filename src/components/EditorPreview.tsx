import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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

function CursorIcon({ type }: { type: string }) {
  const base = "h-8 w-8";
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
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentTimeRef = useRef(currentTimeMs);
  const requestSequenceRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // How many auto-retries have fired for the current source URL.
  const retryCountRef = useRef(0);
  // Time (seconds) to seek to after a retry remount, so playback resumes at the right position.
  const retryRestoreTimeRef = useRef(0);
  // Whether playback was active at the moment the error fired.
  const retryWasPlayingRef = useRef(false);
  const [previewFrame, setPreviewFrame] = useState<PreviewFrameResponse | null>(null);
  const [isLoadingFrame, setIsLoadingFrame] = useState(false);
  // Bumped on each retry attempt to remount the <video> element with a fresh src.
  const [videoRetryKey, setVideoRetryKey] = useState(0);
  const [mediaDurationMs, setMediaDurationMs] = useState(0);
  const [mediaDimensions, setMediaDimensions] = useState<{ width: number; height: number } | null>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
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
  // Cursor coordinates come from frame metadata, so normalize against that space first.
  const sourceWidth = activeCursor?.width ?? orderedCursorTrack[0]?.width ?? mediaDimensions?.width ?? previewFrame?.width ?? 1920;
  const sourceHeight = activeCursor?.height ?? orderedCursorTrack[0]?.height ?? mediaDimensions?.height ?? previewFrame?.height ?? 1080;
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
  const cursorLeft = activeCursor ? (activeCursor.cursorX / sourceWidth) * 100 : 50;
  const cursorTop = activeCursor ? (activeCursor.cursorY / sourceHeight) * 100 : 50;

  const { zoom, marker: zoomFocusMarker } = useMemo(
    () => liveZoomState(zoomMarkers, currentTimeMs, zoomInMs, zoomOutMs, maxZoom),
    [zoomMarkers, currentTimeMs, zoomInMs, zoomOutMs, maxZoom],
  );

  const focusXPercent = zoomFocusMarker && activeCursor && cursorInBounds
    ? clamp((activeCursor.cursorX / sourceWidth) * 100, 5, 95)
    : 50;
  const focusYPercent = zoomFocusMarker && activeCursor && cursorInBounds
    ? clamp((activeCursor.cursorY / sourceHeight) * 100, 5, 95)
    : 50;
  const translateX = (50 - focusXPercent) * (zoom - 1);
  const translateY = (50 - focusYPercent) * (zoom - 1);
  const effectiveInset = Math.max(0, Math.min(220, padding + inset));
  const shadowOpacity = Math.min(1, Math.max(0, shadow / 100));
  const shadowDistance = directionalShadow ? 28 : 0;
  const shadowRadians = (shadowAngle * Math.PI) / 180;
  const shadowX = Math.round(Math.cos(shadowRadians) * shadowDistance);
  const shadowY = Math.round(Math.sin(shadowRadians) * shadowDistance);
  const frameShadow = directionalShadow
    ? `${shadowX}px ${shadowY}px ${shadowBlur}px rgba(0,0,0,${(0.85 * shadowOpacity).toFixed(3)})`
    : `0 16px ${shadowBlur}px rgba(0,0,0,${(0.85 * shadowOpacity).toFixed(3)})`;
  const frameSize = useMemo(() => {
    const availableWidth = Math.max(0, stageSize.width - effectiveInset * 2);
    const availableHeight = Math.max(0, stageSize.height - effectiveInset * 2);

    if (availableWidth <= 0 || availableHeight <= 0) {
      return { width: 0, height: 0 };
    }

    const availableRatio = availableWidth / availableHeight;
    if (availableRatio > previewAspectRatio) {
      const height = availableHeight;
      const width = Math.round(height * previewAspectRatio);
      return { width, height };
    }

    const width = availableWidth;
    const height = Math.round(width / previewAspectRatio);
    return { width, height };
  }, [stageSize.width, stageSize.height, effectiveInset, previewAspectRatio]);
  const cameraCornerClass = useMemo(() => {
    if (cameraCorner === "top-left") return "top-3 left-3";
    if (cameraCorner === "top-right") return "top-3 right-3";
    if (cameraCorner === "bottom-left") return "bottom-3 left-3";
    return "bottom-3 right-3";
  }, [cameraCorner]);

  useEffect(() => {
    currentTimeRef.current = currentTimeMs;
  }, [currentTimeMs]);

  // Seek main video when scrubbing (not playing).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || Number.isNaN(video.duration) || !Number.isFinite(video.duration)) return;
    if (isPlaying) return;

    const nextSeconds = currentTimeMs / 1000;
    if (Math.abs(video.currentTime - nextSeconds) > 0.05) {
      video.currentTime = nextSeconds;
    }
  }, [currentTimeMs, isPlaying]);

  // Keep camera PiP in sync with main video while scrubbing.
  useEffect(() => {
    const cam = cameraRef.current;
    if (!cam || Number.isNaN(cam.duration) || !Number.isFinite(cam.duration)) return;
    if (isPlaying) return;

    const nextSeconds = currentTimeMs / 1000;
    if (Math.abs(cam.currentTime - nextSeconds) > 0.05) {
      cam.currentTime = nextSeconds;
    }
  }, [currentTimeMs, isPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;
  }, [isMuted]);

  // Play/pause main video and camera PiP together.
  useEffect(() => {
    const video = videoRef.current;
    const cam = cameraRef.current;

    if (isPlaying) {
      void video?.play().catch(() => {});
      void cam?.play().catch(() => {});
      return;
    }

    video?.pause();
    cam?.pause();
  }, [isPlaying]);

  // Drive currentTimeMs from the main video clock during playback.
  useEffect(() => {
    if (!isPlaying || !previewUrl) return;

    let frameId = 0;

    const syncToVideoClock = () => {
      const video = videoRef.current;
      if (video && !video.paused) {
        onTimeChange(video.currentTime * 1000);
      }
      frameId = window.requestAnimationFrame(syncToVideoClock);
    };

    frameId = window.requestAnimationFrame(syncToVideoClock);
    return () => window.cancelAnimationFrame(frameId);
  }, [isPlaying, onTimeChange, previewUrl]);

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

    canvas.width = previewFrame.width;
    canvas.height = previewFrame.height;

    const context = canvas.getContext("2d");
    if (!context) return;

    const data = new Uint8ClampedArray(previewFrame.pixelsRgba);
    context.putImageData(new ImageData(data, previewFrame.width, previewFrame.height), 0, 0);
  }, [previewFrame]);

  useEffect(() => {
    if (previewUrl) {
      setMediaDimensions(null);
      setMediaDurationMs(0);
      retryCountRef.current = 0;
      retryRestoreTimeRef.current = 0;
    }
  }, [previewUrl]);

  useEffect(() => {
    const container = stageContainerRef.current;
    if (!container) return;

    const updateStageSize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;

      const containerRatio = width / height;
      if (containerRatio > previewAspectRatio) {
        const nextHeight = height;
        const nextWidth = Math.round(height * previewAspectRatio);
        setStageSize({ width: nextWidth, height: nextHeight });
      } else {
        const nextWidth = width;
        const nextHeight = Math.round(width / previewAspectRatio);
        setStageSize({ width: nextWidth, height: nextHeight });
      }
    };

    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, [previewAspectRatio]);

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
        <div className="flex min-h-0 items-center justify-center p-3">
          <div ref={stageContainerRef} className="relative h-full w-full">
            <div
              className="absolute inset-0 m-auto flex items-center justify-center overflow-hidden rounded-[18px] shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition-all duration-200"
              style={{
                background: stageBackground,
                width: `${stageSize.width}px`,
                height: `${stageSize.height}px`,
              }}
            >
            <div
              className="absolute inset-0 scale-110"
              style={{ background: stageBackground, filter: `blur(${backgroundStyle.blur}px)` }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%)]" />
            <div
              className="relative z-10 overflow-visible border border-white/10 bg-black/40 transition-transform duration-200"
              style={{
                width: `${frameSize.width}px`,
                height: `${frameSize.height}px`,
                borderRadius: `${roundedCorners}px`,
                boxShadow: frameShadow,
                transform: `scale(${scalePercent / 100})`,
              }}
            >
              {/* Zoom + pan layer */}
              <div
                className="absolute inset-0 origin-center transition-transform duration-75 ease-linear"
                style={{ transform: `translate(${translateX}%, ${translateY}%) scale(${zoom})` }}
              >
                {previewUrl ? (
                  <video
                    key={`${previewUrl}-${videoRetryKey}`}
                    ref={videoRef}
                    className="h-full w-full object-contain"
                    src={previewUrl}
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(e) => {
                      if (retryTimerRef.current) {
                        clearTimeout(retryTimerRef.current);
                        retryTimerRef.current = null;
                      }
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
                      // After a retry remount, seek to slightly before where the error
                      // happened.  Seeking to the exact same position would hit the same
                      // corrupt/undecodable region again every retry, causing a visible
                      // flash loop.  Jumping back ensures we land on the prior keyframe
                      // (keyframe interval is ~1 s) so the decoder gets a clean start.
                      if (retryRestoreTimeRef.current > 0) {
                        const errorTime = retryRestoreTimeRef.current;
                        retryRestoreTimeRef.current = 0;
                        // Seek progressively further back on each successive retry so
                        // persistent bad regions are skipped rather than replayed.
                        const stepBack = Math.min(retryCountRef.current * 2, 10);
                        e.currentTarget.currentTime = Math.max(0, errorTime - stepBack);
                        if (retryWasPlayingRef.current) {
                          void e.currentTarget.play().catch(() => {});
                        }
                      }
                    }}
                    onPlaying={() => {
                      // Successful playback — reset retry budget.
                      retryCountRef.current = 0;
                    }}
                    onStalled={(e) => {
                      // Video stalled (e.g. Chromium stops buffering mid-seek on Windows).
                      // Retry only if actually playing or the stall persists; give it 3 s first.
                      if (retryCountRef.current >= 8) return;
                      if (retryTimerRef.current) return; // already scheduled
                      retryTimerRef.current = window.setTimeout(() => {
                        const video = e.currentTarget;
                        if (!video) return;
                        // If still stalled (readyState < HAVE_FUTURE_DATA), remount.
                        if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
                          retryRestoreTimeRef.current = video.currentTime;
                          retryWasPlayingRef.current = !video.paused;
                          retryCountRef.current += 1;
                          setVideoRetryKey((k) => k + 1);
                        }
                        retryTimerRef.current = null;
                      }, 3000);
                    }}
                    onEnded={onPlaybackEnded}
                    onError={(e) => {
                      const code = e.currentTarget.error?.code;
                      const MAX_RETRIES = 8;
                      // Retry all recoverable error codes. Decode errors during playback
                      // are common on Windows (asset.localhost range-request / moov-at-end)
                      // and almost always resolve on a fresh element load.
                      const isRetryable =
                        code === MediaError.MEDIA_ERR_NETWORK ||
                        code === MediaError.MEDIA_ERR_ABORTED ||
                        code === MediaError.MEDIA_ERR_DECODE;
                      if (isRetryable && retryCountRef.current < MAX_RETRIES) {
                        retryRestoreTimeRef.current = e.currentTarget.currentTime;
                        retryWasPlayingRef.current = !e.currentTarget.paused;
                        retryCountRef.current += 1;
                        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
                        // Decode errors are usually transient — short delay. Network errors need
                        // longer to let the file finish flushing.
                        const delay = code === MediaError.MEDIA_ERR_DECODE ? 300 : 1500;
                        retryTimerRef.current = window.setTimeout(() => {
                          setVideoRetryKey((k) => k + 1);
                        }, delay);
                        return;
                      }
                      // Exhausted retries or truly unrecoverable (unsupported source).
                      retryCountRef.current = 0;
                      const reason =
                        code === MediaError.MEDIA_ERR_ABORTED ? "aborted" :
                        code === MediaError.MEDIA_ERR_NETWORK ? "network" :
                        code === MediaError.MEDIA_ERR_DECODE ? "decode" :
                        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? "unsupported-source" :
                        "unknown";
                      onVideoError?.(`Could not load preview video (${reason}): ${previewUrl}`);
                    }}
                  />
                ) : previewFrame ? (
                  <canvas ref={canvasRef} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#36285a_0%,#241b3f_44%,#191726_100%)]">
                    <div className="max-w-140 text-center text-white">
                      <p className="mb-3 text-xs uppercase tracking-[0.35em] text-white/45">SmoothShot Preview</p>
                      <h2 className="mb-3 text-4xl font-medium tracking-[-0.03em]">
                        {isLoadingFrame ? "Loading captured frame" : "Direct frame preview"}
                      </h2>
                      <p className="mx-auto max-w-115 text-sm leading-6 text-white/62">
                        The editor is showing captured frames directly, with cursor and zoom layered on top.
                      </p>
                    </div>
                  </div>
                )}

                {/* Cursor overlay — lives INSIDE the zoom transform so it pans/scales with the video */}
                {showCursor && activeCursor && cursorInBounds && (
                  <div
                    className="pointer-events-none absolute z-20"
                    style={{
                      left: `${cursorLeft}%`,
                      top: `${cursorTop}%`,
                      transform: `translate(-18%, -12%) scale(${cursorScale / 100})`,
                      transformOrigin: "0 0",
                    }}
                  >
                    <CursorIcon
                      type={activeCursor.cursorType ?? "default"}
                    />
                  </div>
                )}
              </div>

            </div>

            {/* Camera PiP overlay on full preview canvas */}
            {cameraUrl && (
              <div className={`pointer-events-none absolute z-30 ${cameraCornerClass}`}>
                <video
                  ref={cameraRef}
                  className="h-28 w-[7.5rem] object-cover shadow-[0_6px_24px_rgba(0,0,0,0.7)] ring-1 ring-white/25"
                  style={{
                    borderRadius: `${cameraRoundness}px`,
                    transform: cameraMirrored ? "scaleX(-1)" : "none",
                  }}
                  src={cameraUrl}
                  playsInline
                  preload="auto"
                  muted
                />
              </div>
            )}
            </div>

            {/* Processing overlay — shown while FFmpeg is finalizing after stop */}
            {isProcessing && (
              <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 rounded-[18px] bg-[rgba(8,9,15,0.82)] backdrop-blur-sm">
                <p className="text-sm font-medium tracking-wide text-white/70">Finalizing recording</p>
                {/* Indeterminate progress bar */}
                <div className="relative h-1 w-48 overflow-hidden rounded-full bg-white/10">
                  <div className="absolute inset-y-0 w-1/2 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-white/60 to-transparent" />
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
