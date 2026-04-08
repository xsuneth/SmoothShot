import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Dispatch, SetStateAction } from "react";

import { WINDOW_LABEL_EDITOR, EVT_SESSION_UPDATED } from "../lib/constants";
import { clickEventsToMarkers, normalizeSessionTiming, toLocalFileUrl } from "../lib/utils";
import type { ClickEvent, FrameMetadata, RecordingStatus, StopRecordingResponse, ZoomMarker } from "../types";

/**
 * Loads and keeps editor session data in sync with backend updates.
 */
export interface UseEditorSessionResult {
  status: RecordingStatus;
  recording: boolean;
  lastSession: StopRecordingResponse | null;
  timeline: ClickEvent[];
  zoomMarkers: ZoomMarker[];
  cursorTrack: FrameMetadata[];
  previewUrl: string | null;
  cameraUrl: string | null;
  previewDurationMs: number;
  /** True while the background stop-processing thread is still running. */
  isProcessing: boolean;
  setZoomMarkers: Dispatch<SetStateAction<ZoomMarker[]>>;
  setPreviewUrl: (url: string | null) => void;
  setPreviewDurationMs: (durationMs: number) => void;
  refreshEditorSessionData: () => Promise<void>;
}

interface UseEditorSessionParams {
  windowLabel: string;
}

const INITIAL_STATUS: RecordingStatus = {
  isRecording: false,
  isPaused: false,
  targetFps: 60,
  framesCaptured: 0,
  clicksDetected: 0,
  elapsedMs: 0,
  sessionFolder: null,
};

export function useEditorSession({ windowLabel }: UseEditorSessionParams): UseEditorSessionResult {
  const [status, setStatus] = useState<RecordingStatus>(INITIAL_STATUS);
  const [recording, setRecording] = useState(false);
  const [lastSession, setLastSession] = useState<StopRecordingResponse | null>(null);
  const [timeline, setTimeline] = useState<ClickEvent[]>([]);
  const [zoomMarkers, setZoomMarkers] = useState<ZoomMarker[]>([]);
  const [cursorTrack, setCursorTrack] = useState<FrameMetadata[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraUrl, setCameraUrl] = useState<string | null>(null);
  const [previewDurationMs, setPreviewDurationMs] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const applySessionSummary = useCallback((summary: StopRecordingResponse | null) => {
    if (!summary) {
      setIsProcessing(false);
      return;
    }

    setLastSession(summary);
    setPreviewDurationMs(summary.durationMs);
    const processing = Boolean(summary.isProcessing);
    setIsProcessing(processing);

    if (!processing) {
      setPreviewUrl(summary.sourceVideoPath ? toLocalFileUrl(summary.sourceVideoPath) : null);
      setCameraUrl(summary.cameraVideoPath ? toLocalFileUrl(summary.cameraVideoPath) : null);
    }
  }, []);

  const refreshEditorSessionData = useCallback(async () => {
    try {
      const summary = await invoke<StopRecordingResponse | null>("get_last_session_summary").catch(() => null);
      applySessionSummary(summary);

      // While backend post-processing runs, avoid expensive timeline/frame calls.
      // They can be large and contend with stop/finalization work.
      const processing = Boolean(summary?.isProcessing);
      const [nextStatus, clicks, frameTrack] = await Promise.all([
        invoke<RecordingStatus>("get_recording_status").catch(() => INITIAL_STATUS),
        processing
          ? Promise.resolve<ClickEvent[]>([])
          : invoke<ClickEvent[]>("get_click_timeline").catch(() => []),
        processing
          ? Promise.resolve<FrameMetadata[]>([])
          : invoke<FrameMetadata[]>("get_frame_timeline", { limit: 20000 }).catch(() => []),
      ]);

      setStatus(nextStatus);
      setRecording(nextStatus.isRecording);

      if (!processing) {
        const normalized = normalizeSessionTiming(clicks, frameTrack);
        setTimeline(normalized.clicks.slice(-16).reverse());
        setZoomMarkers(clickEventsToMarkers(normalized.clicks, summary?.durationMs ?? 0));
        setCursorTrack(normalized.frameTrack);
      }
    } catch {
      // Ignore refresh errors while editor initializes.
    }
  }, [applySessionSummary]);

  // Fallback polling while backend post-processing runs.
  // This recovers if the completion event is missed for any reason.
  useEffect(() => {
    if (windowLabel !== WINDOW_LABEL_EDITOR || !isProcessing) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void invoke<StopRecordingResponse | null>("get_last_session_summary")
        .then((summary) => {
          applySessionSummary(summary);
          if (summary && !summary.isProcessing) {
            // Pull full timeline/cursor data once processing is complete.
            void refreshEditorSessionData();
          }
        })
        .catch(() => {
          // Ignore intermittent poll failures.
        });
    }, 1200);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [windowLabel, isProcessing, applySessionSummary, refreshEditorSessionData]);

  useEffect(() => {
    if (windowLabel !== WINDOW_LABEL_EDITOR) {
      return;
    }

    void refreshEditorSessionData();

    let unlisten: (() => void) | undefined;
    void getCurrentWebviewWindow()
      .listen(EVT_SESSION_UPDATED, () => {
        void refreshEditorSessionData();
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        // Ignore listener registration issues on startup.
      });

    return () => {
      unlisten?.();
    };
  }, [windowLabel, refreshEditorSessionData]);

  return {
    status,
    recording,
    lastSession,
    timeline,
    zoomMarkers,
    cursorTrack,
    previewUrl,
    cameraUrl,
    previewDurationMs,
    isProcessing,
    setZoomMarkers,
    setPreviewUrl,
    setPreviewDurationMs,
    refreshEditorSessionData,
  };
}
