import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  BackgroundStyle,
  FrameMetadata,
  GpuInitStatus,
  PreviewFrameResponse,
  RecordingStatus,
  ZoomMarker,
} from "../types";
import { backgroundCss } from "../lib/theme";

type EditorPreviewProps = {
  backgroundStyle: BackgroundStyle;
  cameraUrl?: string | null;
  currentTimeMs: number;
  cursorTrack: FrameMetadata[];
  gpuStatus: GpuInitStatus | null;
  isPlaying: boolean;
  isMuted: boolean;
  maxZoom: number;
  previewUrl: string | null;
  scalePercent: number;
  sessionDurationMs: number;
  status: RecordingStatus;
  zoomInMs: number;
  zoomMarkers: ZoomMarker[];
  zoomOutMs: number;
  onDurationChange: (durationMs: number) => void;
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

function cubicBlend(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
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
  const before = cursorTrack[Math.max(leftIndex - 1, 0)];
  const after = cursorTrack[Math.min(leftIndex + 2, cursorTrack.length - 1)];
  const span = Math.max(right.timestampMs - left.timestampMs, 1);
  const blend = clamp((currentTimeMs - left.timestampMs) / span, 0, 1);

  return {
    ...left,
    cursorX: Math.round(cubicBlend(before.cursorX, left.cursorX, right.cursorX, after.cursorX, blend)),
    cursorY: Math.round(cubicBlend(before.cursorY, left.cursorY, right.cursorY, after.cursorY, blend)),
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
  backgroundStyle,
  cameraUrl,
  currentTimeMs,
  cursorTrack,
  gpuStatus,
  isPlaying,
  isMuted,
  maxZoom,
  previewUrl,
  scalePercent,
  sessionDurationMs,
  status,
  zoomInMs,
  zoomMarkers,
  zoomOutMs,
  onDurationChange,
  onPlaybackEnded,
  onSeekBy,
  onTimeChange,
  onToggleMute,
  onTogglePlay,
  onVideoError,
}: EditorPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentTimeRef = useRef(currentTimeMs);
  const requestSequenceRef = useRef(0);
  const [previewFrame, setPreviewFrame] = useState<PreviewFrameResponse | null>(null);
  const [isLoadingFrame, setIsLoadingFrame] = useState(false);
  const stageBackground = backgroundCss(backgroundStyle);

  const activeCursor = useMemo(() => interpolateCursor(cursorTrack, currentTimeMs), [cursorTrack, currentTimeMs]);
  const sourceWidth = previewFrame?.width ?? activeCursor?.width ?? cursorTrack[0]?.width ?? 1920;
  const sourceHeight = previewFrame?.height ?? activeCursor?.height ?? cursorTrack[0]?.height ?? 1080;
  const cursorLeft = activeCursor ? clamp((activeCursor.cursorX / sourceWidth) * 100, 0, 100) : 50;
  const cursorTop = activeCursor ? clamp((activeCursor.cursorY / sourceHeight) * 100, 0, 100) : 50;

  const { zoom, marker: zoomFocusMarker } = useMemo(
    () => liveZoomState(zoomMarkers, currentTimeMs, zoomInMs, zoomOutMs, maxZoom),
    [zoomMarkers, currentTimeMs, zoomInMs, zoomOutMs, maxZoom],
  );

  const focusXPercent = zoomFocusMarker && activeCursor ? clamp((activeCursor.cursorX / sourceWidth) * 100, 5, 95) : 50;
  const focusYPercent = zoomFocusMarker && activeCursor ? clamp((activeCursor.cursorY / sourceHeight) * 100, 5, 95) : 50;
  const translateX = (50 - focusXPercent) * (zoom - 1);
  const translateY = (50 - focusYPercent) * (zoom - 1);

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
        <div className="flex min-h-0 items-center justify-center px-6 py-5">
          <div
            className="relative flex aspect-video w-full max-w-215 items-center justify-center overflow-hidden rounded-[18px] shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition-all duration-200"
            style={{ background: stageBackground }}
          >
            <div
              className="absolute inset-0 scale-110"
              style={{ background: stageBackground, filter: `blur(${backgroundStyle.blur}px)` }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%)]" />
            <div
              className="relative z-10 aspect-video w-[82%] overflow-hidden rounded-[18px] border border-white/10 bg-black/40 shadow-[0_16px_50px_rgba(0,0,0,0.4)] transition-transform duration-200"
              style={{ transform: `scale(${scalePercent / 100})` }}
            >
              {/* Zoom + pan layer */}
              <div
                className="absolute inset-0 origin-center transition-transform duration-75 ease-linear"
                style={{ transform: `translate(${translateX}%, ${translateY}%) scale(${zoom})` }}
              >
                {previewUrl ? (
                  <video
                    ref={videoRef}
                    className="h-full w-full object-cover"
                    src={previewUrl}
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(e) => onDurationChange(e.currentTarget.duration * 1000)}
                    onEnded={onPlaybackEnded}
                    onError={(e) => {
                      const code = e.currentTarget.error?.code;
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
                  <canvas ref={canvasRef} className="h-full w-full object-cover" />
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
              </div>

              {/* Cursor overlay */}
              <div className="pointer-events-none absolute inset-0 z-20">
                {activeCursor && (
                  <div
                    className="absolute -translate-x-[18%] -translate-y-[12%]"
                    style={{ left: `${cursorLeft}%`, top: `${cursorTop}%` }}
                  >
                    <svg viewBox="0 0 24 24" className="h-8 w-8 drop-shadow-[0_8px_14px_rgba(0,0,0,0.5)]" fill="none">
                      <path
                        d="M6 3.5 16.5 14l-4.3.9 1.9 5.6-2.7.9-1.9-5.5-3.8 2L6 3.5Z"
                        fill="white"
                        stroke="rgba(12,14,20,0.85)"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}
              </div>

              {/* Camera PiP overlay — bottom-right corner */}
              {cameraUrl && (
                <div className="pointer-events-none absolute bottom-3 right-3 z-30">
                  <video
                    ref={cameraRef}
                    className="h-28 w-[7.5rem] rounded-xl object-cover shadow-[0_4px_18px_rgba(0,0,0,0.6)] ring-1 ring-white/20"
                    src={cameraUrl}
                    playsInline
                    preload="auto"
                    muted
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4 border-l border-white/6 py-6 text-white/62">
          <button type="button" className="rounded-lg p-2 transition hover:bg-white/6 hover:text-white">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M7 4h10v10H7zM4 7h10v10H4z" />
            </svg>
          </button>
          <button type="button" className="rounded-lg p-2 transition hover:bg-white/6 hover:text-white">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 4v16M4 12h16" />
            </svg>
          </button>
          <button type="button" className="rounded-lg p-2 transition hover:bg-white/6 hover:text-white">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4.5" y="6" width="15" height="10" rx="2" />
              <path d="M9 19h6" />
            </svg>
          </button>
          <button type="button" className="rounded-lg p-2 transition hover:bg-white/6 hover:text-white">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 4a2.5 2.5 0 0 1 2.5 2.5V12A2.5 2.5 0 0 1 12 14.5 2.5 2.5 0 0 1 9.5 12V6.5A2.5 2.5 0 0 1 12 4z" />
              <path d="M7 11.5a5 5 0 0 0 10 0M12 16.5V20M9 20h6" />
            </svg>
          </button>
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
