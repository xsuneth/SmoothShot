import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  WINDOW_LABEL_EDITOR,
  EVT_SESSION_UPDATED,
  EVT_CAMERA_RECORD_START,
  EVT_CAMERA_RECORD_STOP,
} from "../lib/constants";
import type {
  CaptureRegion,
  LauncherMode,
  RecordingStatus,
  StartRecordingRequest,
} from "../types";

export interface UseRecordingFlowResult {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  restartRecording: () => Promise<void>;
  deleteRecording: () => Promise<void>;
}

interface UseRecordingFlowParams {
  launcherMode: LauncherMode | null;
  displaySelection: string;
  fps: number;
  region: CaptureRegion;
  cameraDevice: string | null;
  hidePicker: () => Promise<void>;
  setStatus: (status: RecordingStatus) => void;
  setRecording: (recording: boolean) => void;
}

/** Show the editor window and notify it that a new session is ready. */
async function openEditor() {
  const editor = await WebviewWindow.getByLabel(WINDOW_LABEL_EDITOR);
  if (editor) {
    await editor.show();
    await editor.setFocus();
    await editor.emit(EVT_SESSION_UPDATED, null);
  }
}

export function useRecordingFlow({
  launcherMode,
  displaySelection,
  fps,
  region,
  cameraDevice,
  hidePicker,
  setStatus,
  setRecording,
}: UseRecordingFlowParams): UseRecordingFlowResult {
  const startRecording = useCallback(async () => {
    try {
      await hidePicker();
      const effectiveMode = launcherMode ?? "display";
      const request: StartRecordingRequest = {
        fps,
        region: effectiveMode === "area" ? region : null,
        displayIndex: displaySelection.length > 0 ? Number(displaySelection) : null,
      };
      const nextStatus = await invoke<RecordingStatus>("start_recording", {
        request,
        cameraDevice,
      });
      setStatus(nextStatus);
      setRecording(true);

      // If camera is selected and session folder is available, start MediaRecorder
      if (cameraDevice && nextStatus.sessionFolder) {
        void emit(EVT_CAMERA_RECORD_START, { sessionFolder: nextStatus.sessionFolder });
      }
    } catch (error) {
      console.error("Could not start recording:", error);
    }
  }, [hidePicker, launcherMode, fps, region, displaySelection, cameraDevice, setStatus, setRecording]);

  const stopRecording = useCallback(async () => {
    try {
      void emit(EVT_CAMERA_RECORD_STOP, { save: true });
      await invoke("stop_recording");
      setRecording(false);
      await getCurrentWindow().hide();
      await openEditor();
    } catch (error) {
      console.error("Could not stop recording:", error);
    }
  }, [setRecording]);

  const pauseRecording = useCallback(async () => {
    try {
      const nextStatus = await invoke<RecordingStatus>("pause_recording");
      setStatus(nextStatus);
    } catch (error) {
      console.error("Could not pause recording:", error);
    }
  }, [setStatus]);

  const resumeRecording = useCallback(async () => {
    try {
      const nextStatus = await invoke<RecordingStatus>("resume_recording");
      setStatus(nextStatus);
    } catch (error) {
      console.error("Could not resume recording:", error);
    }
  }, [setStatus]);

  const restartRecording = useCallback(async () => {
    try {
      // Discard current session, then start fresh with the same config.
      await invoke("delete_recording");
      setRecording(false);
      const effectiveMode = launcherMode ?? "display";
      const request: StartRecordingRequest = {
        fps,
        region: effectiveMode === "area" ? region : null,
        displayIndex: displaySelection.length > 0 ? Number(displaySelection) : null,
      };
      const nextStatus = await invoke<RecordingStatus>("start_recording", {
        request,
        cameraDevice,
      });
      setStatus(nextStatus);
      setRecording(true);
    } catch (error) {
      console.error("Could not restart recording:", error);
    }
  }, [launcherMode, fps, region, displaySelection, cameraDevice, setStatus, setRecording]);

  const deleteRecording = useCallback(async () => {
    try {
      void emit(EVT_CAMERA_RECORD_STOP, { save: false });
      await invoke("delete_recording");
      setRecording(false);
      await getCurrentWindow().hide();
    } catch (error) {
      console.error("Could not delete recording:", error);
    }
  }, [setRecording]);

  return {
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    restartRecording,
    deleteRecording,
  };
}
