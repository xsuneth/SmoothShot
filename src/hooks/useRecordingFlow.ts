import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  WINDOW_LABEL_EDITOR,
  WINDOW_LABEL_CAMERA_PREVIEW,
  WINDOW_LABEL_COUNTDOWN,
  EVT_SESSION_UPDATED,
  EVT_CAMERA_PREVIEW_DATA,
  EVT_CAMERA_RECORD_START,
  EVT_CAMERA_RECORD_STOP,
  EVT_COUNTDOWN_START,
} from "../lib/constants";
import type {
  CaptureRegion,
  DisplayDescriptor,
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
  displays: DisplayDescriptor[];
  displaySelection: string;
  fps: number;
  region: CaptureRegion;
  cameraDevice: string | null;
  hidePicker: () => Promise<void>;
  setStatus: (status: RecordingStatus) => void;
  setRecording: (recording: boolean) => void;
}

type CameraPreviewPayload = {
  selectedCameraDevice: string | null;
};

/** Show the editor window and notify it that a new session is ready. */
async function openEditor() {
  const editor = await WebviewWindow.getByLabel(WINDOW_LABEL_EDITOR);
  if (editor) {
    await editor.show();
    await editor.setFocus();
    await editor.emit(EVT_SESSION_UPDATED, null);
  }
}

/** Show the countdown overlay on the target display and wait 3 seconds. */
async function runCountdown(
  displays: DisplayDescriptor[],
  displaySelection: string,
): Promise<void> {
  const display = displays.find((d) => String(d.index) === displaySelection) ?? displays[0];
  if (!display) return;

  try {
    await invoke("show_countdown_on_display", {
      displayX: display.x,
      displayY: display.y,
      displayWidth: display.width,
      displayHeight: display.height,
    });

    // Tell the countdown window to start its 3→1 animation now.
    const countdownWin = await WebviewWindow.getByLabel(WINDOW_LABEL_COUNTDOWN);
    if (countdownWin) {
      await countdownWin.emit(EVT_COUNTDOWN_START, null);
    }

    // Wait 3 seconds for the countdown to finish.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 3000));
  } catch {
    // Countdown window might not be ready — still wait so recording doesn't
    // start immediately without any visual feedback.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 3000));
  }

  try {
    await invoke("hide_countdown");
  } catch {
    // Ignore hide failures.
  }
}

/** Ensure the hidden camera-preview webview has an active stream before recording starts. */
async function ensureCameraPreviewPipeline(cameraDevice: string | null): Promise<void> {
  if (!cameraDevice) return;

  const preview = await WebviewWindow.getByLabel(WINDOW_LABEL_CAMERA_PREVIEW);
  if (!preview) return;

  await preview
    .emit(EVT_CAMERA_PREVIEW_DATA, {
      selectedCameraDevice: cameraDevice,
    } satisfies CameraPreviewPayload)
    .catch(() => {});

  // Give getUserMedia a short warm-up window before MediaRecorder start event.
  await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
}

/** Stop camera recording, tear down preview input stream, and hide preview window. */
async function shutdownCameraPreviewPipeline(save: boolean): Promise<void> {
  await emit(EVT_CAMERA_RECORD_STOP, { save }).catch(() => {});

  const preview = await WebviewWindow.getByLabel(WINDOW_LABEL_CAMERA_PREVIEW);
  if (!preview) return;

  await preview
    .emit(EVT_CAMERA_PREVIEW_DATA, {
      selectedCameraDevice: null,
    } satisfies CameraPreviewPayload)
    .catch(() => {});

  await preview.hide().catch(() => {});
}

export function useRecordingFlow({
  launcherMode,
  displays,
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

      // Run countdown overlay on the target display before recording starts.
      await runCountdown(displays, displaySelection);

      await ensureCameraPreviewPipeline(cameraDevice);

      const nextStatus = await invoke<RecordingStatus>("start_recording", {
        request,
        cameraDevice,
      });
      setStatus(nextStatus);
      setRecording(true);

      // If camera is selected and session folder is available, start MediaRecorder.
      if (cameraDevice && nextStatus.sessionFolder) {
        await emit(EVT_CAMERA_RECORD_START, { sessionFolder: nextStatus.sessionFolder });
      }
    } catch (error) {
      console.error("Could not start recording:", error);
      // Ensure countdown is hidden even on error.
      void invoke("hide_countdown").catch(() => {});
    }
  }, [hidePicker, launcherMode, fps, region, displaySelection, displays, cameraDevice, setStatus, setRecording]);

  const stopRecording = useCallback(async () => {
    try {
      await shutdownCameraPreviewPipeline(true);
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
      await shutdownCameraPreviewPipeline(false);
      await invoke("delete_recording");
      setRecording(false);
      const effectiveMode = launcherMode ?? "display";
      const request: StartRecordingRequest = {
        fps,
        region: effectiveMode === "area" ? region : null,
        displayIndex: displaySelection.length > 0 ? Number(displaySelection) : null,
      };

      await ensureCameraPreviewPipeline(cameraDevice);

      const nextStatus = await invoke<RecordingStatus>("start_recording", {
        request,
        cameraDevice,
      });
      setStatus(nextStatus);
      setRecording(true);

      if (cameraDevice && nextStatus.sessionFolder) {
        await emit(EVT_CAMERA_RECORD_START, { sessionFolder: nextStatus.sessionFolder });
      }
    } catch (error) {
      console.error("Could not restart recording:", error);
    }
  }, [launcherMode, fps, region, displaySelection, cameraDevice, setStatus, setRecording]);

  const deleteRecording = useCallback(async () => {
    try {
      await shutdownCameraPreviewPipeline(false);
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
