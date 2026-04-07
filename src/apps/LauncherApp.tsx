import { useCallback, useEffect, useRef, useState } from "react";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { LauncherBar } from "../components/LauncherBar";
import { WINDOW_LABEL_MAIN, EVT_CAMERA_RECORD_STOP } from "../lib/constants";
import { resolveDeviceLabel, resolveDisplayLabel } from "../lib/utils";
import type { CaptureRegion, LauncherMode } from "../types";
import { useAppStore } from "../store/useAppStore";
import { useAudioControls } from "../hooks/useAudioControls";
import { useCameraPreviewWindow } from "../hooks/useCameraPreviewWindow";
import { useDeviceMenus } from "../hooks/useDeviceMenus";
import { useDisplayPicker } from "../hooks/useDisplayPicker";
import { useDisplays } from "../hooks/useDisplays";
import { useInputDevices } from "../hooks/useInputDevices";
import { useLauncherEvents } from "../hooks/useLauncherEvents";
import { useRecordingFlow } from "../hooks/useRecordingFlow";
import { useRecordingStatus } from "../hooks/useRecordingStatus";
import { useWindowPositioning } from "../hooks/useWindowPositioning";

export function LauncherApp() {
  const [launcherVisible, setLauncherVisible] = useState(false);
  const [isShrinking, setIsShrinking] = useState(false);
  const [micInputLevel, setMicInputLevel] = useState(0);
  const transitionToken = useRef(0);
  const [region] = useState<CaptureRegion>({ x: 100, y: 100, width: 1280, height: 720 });

  // ── Persisted settings ──────────────────────────────────────────────────────
  const cameraEnabled = useAppStore((s) => s.cameraEnabled);
  const setCameraEnabled = useAppStore((s) => s.setCameraEnabled);
  const launcherMode = useAppStore((s) => s.launcherMode);
  const setLauncherMode = useAppStore((s) => s.setLauncherMode);
  const fps = useAppStore((s) => s.fps);

  // ── Devices ─────────────────────────────────────────────────────────────────
  const { displays, displaySelection, setDisplaySelection, loadDisplays } = useDisplays();
  const {
    cameraDevices,
    microphoneDevices,
    selectedCameraDevice,
    selectedMicrophoneDevice,
    setSelectedCameraDevice,
    setSelectedMicrophoneDevice,
  } = useInputDevices();

  const { status, recording, setStatus, setRecording } = useRecordingStatus();
  const { micEnabled, appAudioEnabled, toggleMic, toggleAppAudio } = useAudioControls();

  // ── Display picker ──────────────────────────────────────────────────────────
  const { showDisplayMenu, hideDisplayPopup, isDisplayPickerOpen, setPickerOpen } = useDisplayPicker({
    displays,
    displaySelection,
    loadDisplays,
    setMessage: (msg) => { console.error(msg); },
  });

  // ── Window positioning ──────────────────────────────────────────────────────
  const { positionAndShow } = useWindowPositioning({
    onVisibleChange: setLauncherVisible,
  });

  // ── Device menus ────────────────────────────────────────────────────────────
  const { showCameraMenu, showMicMenu } = useDeviceMenus({
    cameraDevices,
    microphoneDevices,
    selectedCameraDevice,
    selectedMicrophoneDevice,
    cameraEnabled,
    micEnabled,
    setSelectedCameraDevice,
    setSelectedMicrophoneDevice,
    setCameraEnabled,
    setMessage: () => {},
    toggleMic,
  });

  // ── Recording ───────────────────────────────────────────────────────────────
  const {
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    restartRecording,
    deleteRecording,
  } = useRecordingFlow({
    launcherMode,
    displaySelection,
    fps,
    region,
    cameraDevice: cameraEnabled ? selectedCameraDevice : null,
    hidePicker: hideDisplayPopup,
    setStatus,
    setRecording,
  });

  // ── Camera preview window ───────────────────────────────────────────────────
  const { hideCameraPreviewWindow, syncCameraPreviewWindow } = useCameraPreviewWindow({
    selectedCameraDevice,
  });

  // ── Picker callbacks ────────────────────────────────────────────────────────
  const onPickerSelect = useCallback(async (selection: string) => {
    setDisplaySelection(selection);
    await hideDisplayPopup();
  }, [hideDisplayPopup, setDisplaySelection]);

  const onPickerRecord = useCallback(async (selection: string) => {
    setDisplaySelection(selection);
    setLauncherMode("display");
    await hideDisplayPopup();
    await startRecording();
  }, [hideDisplayPopup, setDisplaySelection, setLauncherMode, startRecording]);

  const onPickerClosed = useCallback(async () => {
    setPickerOpen(false);
  }, [setPickerOpen]);

  const onWindowMoved = useCallback(async () => {
    await hideDisplayPopup();
  }, [hideDisplayPopup]);

  useLauncherEvents({
    windowLabel: WINDOW_LABEL_MAIN,
    onMicLevel: setMicInputLevel,
    onPickerSelect,
    onPickerRecord,
    onPickerClosed,
    onWindowMoved,
  });

  useEffect(() => {
    // Rust setup hook positions the window before JS runs; just show it here.
    void positionAndShow(true);
  }, [positionAndShow]);

  function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  async function animateLauncherWindowKeepingCenter(width: number, height: number, durationMs = 260, token = 0) {
    const win = getCurrentWindow();
    const outerPos = await win.outerPosition();
    const outerSize = await win.outerSize();
    const centerX = outerPos.x + outerSize.width / 2;
    const centerY = outerPos.y + outerSize.height / 2;

    const startW = outerSize.width;
    const startH = outerSize.height;
    const steps = 14;

    for (let step = 1; step <= steps; step += 1) {
      if (token !== transitionToken.current) {
        return;
      }

      const t = step / steps;
      const e = easeInOutCubic(t);
      const nextW = Math.round(startW + (width - startW) * e);
      const nextH = Math.round(startH + (height - startH) * e);
      const nextX = Math.round(centerX - nextW / 2);
      const nextY = Math.round(centerY - nextH / 2);

      await win.setSize(new LogicalSize(nextW, nextH));
      await win.setPosition(new LogicalPosition(nextX, nextY));
      await new Promise((resolve) => window.setTimeout(resolve, durationMs / steps));
    }
  }

  useEffect(() => {
    const token = transitionToken.current + 1;
    transitionToken.current = token;

    const run = async () => {
      setIsShrinking(true);

      if (recording) {
        await animateLauncherWindowKeepingCenter(231, 52, 280, token);
        if (token === transitionToken.current) {
          setIsShrinking(false);
        }
        return;
      }

      await animateLauncherWindowKeepingCenter(746, 60, 280, token);
      if (token === transitionToken.current) {
        setIsShrinking(false);
      }
    };

    void run().catch(() => {
      setIsShrinking(false);
    });

    return () => {
      transitionToken.current += 1;
    };
  }, [recording]);

  useEffect(() => {
    console.log("[LauncherApp] Camera sync - enabled:", cameraEnabled, "device:", selectedCameraDevice);
    void syncCameraPreviewWindow(cameraEnabled);
  }, [cameraEnabled, selectedCameraDevice, syncCameraPreviewWindow]);

  // ── Labels ──────────────────────────────────────────────────────────────────
  const selectedDisplayLabel = resolveDisplayLabel(displays, displaySelection);
  const selectedCameraLabel = resolveDeviceLabel(cameraDevices, selectedCameraDevice, "Camera");
  const selectedMicrophoneLabel = resolveDeviceLabel(microphoneDevices, selectedMicrophoneDevice, "Microphone");

  async function hideLauncher() {
    try {
      await hideDisplayPopup();
      await hideCameraPreviewWindow();

      // Stop camera recording if it was active
      void emit(EVT_CAMERA_RECORD_STOP, { save: false }).catch(() => {});

      // Stop audio inputs when launcher closes (disable mic meter + system audio capture)
      void invoke("set_audio_config", {
        config: { systemAudioEnabled: false, micEnabled: false, systemAudioGain: 1.0, micGain: 1.0 },
      }).catch(() => {});

      setLauncherVisible(false);
      await new Promise((r) => window.setTimeout(r, 140));
      await getCurrentWindow().hide();
    } catch {
      // Ignore hide failures.
    }
  }

  function selectLauncherMode(mode: LauncherMode) {
    if (mode === "window") {
      console.warn("Window capture mode is planned. Using display capture for now.");
      return;
    }
    setLauncherMode(mode);
  }

  return (
    <LauncherBar
      isVisible={launcherVisible}
      isRecording={recording}
      isPaused={status.isPaused}
      isShrinking={isShrinking}
      elapsedMs={status.elapsedMs}
      launcherMode={launcherMode}
      isDisplayPickerOpen={isDisplayPickerOpen}
      selectedDisplayLabel={selectedDisplayLabel}
      region={region}
      cameraEnabled={cameraEnabled}
      micEnabled={micEnabled}
      appAudioEnabled={appAudioEnabled}
      cameraLabel={selectedCameraLabel}
      micLabel={selectedMicrophoneLabel}
      micInputLevel={micInputLevel}
      onHide={hideLauncher}
      onDismissDisplayPopup={hideDisplayPopup}
      onSelectMode={selectLauncherMode}
      onOpenDisplayMenu={(x, y) => void showDisplayMenu(x, y)}
      onOpenCameraMenu={(x, y) => void showCameraMenu(x, y)}
      onOpenMicMenu={(x, y) => void showMicMenu(x, y)}
      onToggleAppAudio={() => void toggleAppAudio()}
      onShowSourceInfo={() => {}}
      onStopRecording={() => void stopRecording()}
      onPauseRecording={() => void pauseRecording()}
      onResumeRecording={() => void resumeRecording()}
      onRestartRecording={() => void restartRecording()}
      onDeleteRecording={() => void deleteRecording()}
    />
  );
}
