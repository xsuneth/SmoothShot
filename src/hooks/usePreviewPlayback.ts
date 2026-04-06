import { useCallback, useEffect, useState } from "react";

export interface UsePreviewPlaybackResult {
  currentTimeMs: number;
  isPlayingPreview: boolean;
  isMutedPreview: boolean;
  setCurrentTimeMs: (timeMs: number) => void;
  setIsPlayingPreview: (playing: boolean) => void;
  seekPreview: (timeMs: number) => void;
  seekPreviewBy: (deltaMs: number) => void;
  togglePreviewPlayback: (hasContent: boolean, sessionDurationMs: number) => void;
  toggleMutePreview: () => void;
}

export function usePreviewPlayback(
  previewUrl: string | null,
  sessionDurationMs: number,
): UsePreviewPlaybackResult {
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isMutedPreview, setIsMutedPreview] = useState(false);

  // rAF ticker for frame-based playback (when no video URL is available)
  useEffect(() => {
    if (!isPlayingPreview || previewUrl) return;

    let frameId = 0;
    let previous = performance.now();

    function tick(now: number) {
      const delta = now - previous;
      previous = now;

      setCurrentTimeMs((prev) => {
        const next = Math.min(prev + delta, Math.max(sessionDurationMs, 0));
        if (next >= Math.max(sessionDurationMs, 0)) {
          setIsPlayingPreview(false);
        }
        return next;
      });

      frameId = window.requestAnimationFrame(tick);
    }

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [isPlayingPreview, previewUrl, sessionDurationMs]);

  const seekPreview = useCallback((timeMs: number) => {
    setCurrentTimeMs(Math.min(Math.max(0, timeMs), Math.max(sessionDurationMs, 0)));
  }, [sessionDurationMs]);

  const seekPreviewBy = useCallback((deltaMs: number) => {
    setCurrentTimeMs((prev) =>
      Math.min(Math.max(0, prev + deltaMs), Math.max(sessionDurationMs, 0)),
    );
  }, [sessionDurationMs]);

  function togglePreviewPlayback(hasContent: boolean, duration: number) {
    if (!hasContent && duration <= 0) return;
    setIsPlayingPreview((prev) => !prev);
  }

  function toggleMutePreview() {
    setIsMutedPreview((prev) => !prev);
  }

  return {
    currentTimeMs,
    isPlayingPreview,
    isMutedPreview,
    setCurrentTimeMs,
    setIsPlayingPreview,
    seekPreview,
    seekPreviewBy,
    togglePreviewPlayback,
    toggleMutePreview,
  };
}
