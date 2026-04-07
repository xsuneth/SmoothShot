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

  const refreshEditorSessionData = useCallback(async () => {
    try {
      const [nextStatus, clicks, summary, frameTrack] = await Promise.all([
        invoke<RecordingStatus>("get_recording_status"),
        invoke<ClickEvent[]>("get_click_timeline"),
        invoke<StopRecordingResponse | null>("get_last_session_summary"),
        invoke<FrameMetadata[]>("get_frame_timeline", { limit: 5000 }),
      ]);

      const normalized = normalizeSessionTiming(clicks, frameTrack);
      setStatus(nextStatus);
      setRecording(nextStatus.isRecording);
      setTimeline(normalized.clicks.slice(-16).reverse());
      setZoomMarkers(clickEventsToMarkers(normalized.clicks, summary?.durationMs ?? 0));
      setCursorTrack(normalized.frameTrack);

      if (summary) {
        setLastSession(summary);
        setPreviewDurationMs(summary.durationMs);
        setPreviewUrl(summary.sourceVideoPath ? toLocalFileUrl(summary.sourceVideoPath) : null);
        setCameraUrl(summary.cameraVideoPath ? toLocalFileUrl(summary.cameraVideoPath) : null);
      }
    } catch {
      // Ignore refresh errors while editor initializes.
    }
  }, []);

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
    setZoomMarkers,
    setPreviewUrl,
    setPreviewDurationMs,
    refreshEditorSessionData,
  };
}
