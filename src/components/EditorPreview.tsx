import { useEffect, useRef } from "react";

import type { BackgroundStyle, GpuInitStatus, RecordingStatus } from "../types";

type EditorPreviewProps = {
  backgroundStyle: BackgroundStyle;
  currentTimeMs: number;
  gpuStatus: GpuInitStatus | null;
  isPlaying: boolean;
  previewUrl: string | null;
  scalePercent: number;
  sessionDurationMs: number;
  status: RecordingStatus;
  onDurationChange: (durationMs: number) => void;
  onPlaybackEnded: () => void;
  onSeekBy: (deltaMs: number) => void;
  onTimeChange: (timeMs: number) => void;
  onTogglePlay: () => void;
};

const wallpapers: Record<string, string> = {
  macos: "linear-gradient(135deg, #2241a8 0%, #4c2f7e 38%, #3d234f 100%)",
  spring: "linear-gradient(135deg, #6cd5b6 0%, #2c7aa8 45%, #19334d 100%)",
  sunset: "linear-gradient(135deg, #ff9966 0%, #ff5e62 35%, #59253a 100%)",
  radial: "radial-gradient(circle at top, #5b3f95 0%, #24163d 55%, #120f1f 100%)",
};

const gradients: Record<string, string> = {
  aurora: "linear-gradient(135deg, #30cfd0 0%, #330867 100%)",
  candy: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  ocean: "linear-gradient(135deg, #43cea2 0%, #185a9d 100%)",
  ember: "linear-gradient(135deg, #ffaf7b 0%, #d76d77 100%)",
};

const colors: Record<string, string> = {
  midnight: "#10131f",
  plum: "#2d2344",
  slate: "#19202c",
  cream: "#ece2d0",
};

function backgroundCss(style: BackgroundStyle) {
  if (style.tab === "wallpaper") {
    return wallpapers[style.value] ?? wallpapers.macos;
  }

  if (style.tab === "gradient") {
    return gradients[style.value] ?? gradients.aurora;
  }

  if (style.tab === "color") {
    return colors[style.value] ?? colors.midnight;
  }

  if (style.value.trim()) {
    return `url("${style.value}") center/cover no-repeat`;
  }

  return wallpapers.macos;
}

export function EditorPreview({
  backgroundStyle,
  currentTimeMs,
  gpuStatus,
  isPlaying,
  previewUrl,
  scalePercent,
  sessionDurationMs,
  status,
  onDurationChange,
  onPlaybackEnded,
  onSeekBy,
  onTimeChange,
  onTogglePlay,
}: EditorPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageBackground = backgroundCss(backgroundStyle);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || Number.isNaN(video.duration) || !Number.isFinite(video.duration)) {
      return;
    }

    const nextSeconds = currentTimeMs / 1000;
    if (Math.abs(video.currentTime - nextSeconds) > 0.05) {
      video.currentTime = nextSeconds;
    }
  }, [currentTimeMs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (isPlaying) {
      void video.play().catch(() => {
        // Ignore autoplay rejection; transport remains interactive.
      });
      return;
    }

    video.pause();
  }, [isPlaying]);

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
            className="relative flex aspect-video w-full max-w-[860px] items-center justify-center overflow-hidden rounded-[18px] shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition-all duration-200"
            style={{ background: stageBackground }}
          >
            <div
              className="absolute inset-0 scale-110"
              style={{
                background: stageBackground,
                filter: `blur(${backgroundStyle.blur}px)`,
              }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_55%)]" />
            <div
              className="relative z-10 aspect-video w-[82%] overflow-hidden rounded-[18px] border border-white/10 bg-black/40 shadow-[0_16px_50px_rgba(0,0,0,0.4)] transition-transform duration-200"
              style={{ transform: `scale(${scalePercent / 100})` }}
            >
              {!previewUrl && (
                <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#36285a_0%,#241b3f_44%,#191726_100%)]">
                  <div className="max-w-[520px] text-center text-white">
                    <p className="mb-3 text-xs uppercase tracking-[0.35em] text-white/45">SmoothShot Preview</p>
                    <h2 className="mb-3 text-4xl font-medium tracking-[-0.03em]">Live Editor Preview</h2>
                    <p className="mx-auto max-w-[440px] text-sm leading-6 text-white/62">
                      Background, scale, and timeline changes now update the preview surface immediately.
                    </p>
                  </div>
                </div>
              )}
              {previewUrl && (
                <video
                  ref={videoRef}
                  className="h-full w-full object-cover"
                  src={previewUrl}
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(event) => onDurationChange(event.currentTarget.duration * 1000)}
                  onTimeUpdate={(event) => onTimeChange(event.currentTarget.currentTime * 1000)}
                  onEnded={onPlaybackEnded}
                />
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
