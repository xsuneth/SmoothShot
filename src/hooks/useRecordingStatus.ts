import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { RecordingStatus } from "../types";

/**
 * Polls and exposes backend recording status state.
 */
export interface UseRecordingStatusResult {
  status: RecordingStatus;
  recording: boolean;
  setStatus: (status: RecordingStatus) => void;
  setRecording: (recording: boolean) => void;
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

export function useRecordingStatus(): UseRecordingStatusResult {
  const [status, setStatus] = useState<RecordingStatus>(INITIAL_STATUS);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const nextStatus = await invoke<RecordingStatus>("get_recording_status");
        setStatus(nextStatus);
        setRecording(nextStatus.isRecording);
      } catch {
        // Ignore polling errors while backend boots.
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return {
    status,
    recording,
    setStatus,
    setRecording,
  };
}
