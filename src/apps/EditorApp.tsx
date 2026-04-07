import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { EditorWindow } from "./EditorWindow";
import { WINDOW_LABEL_EDITOR, WINDOW_LABEL_MAIN } from "../lib/constants";
import { useBackground } from "../hooks/useBackground";
import { useEditorSession } from "../hooks/useEditorSession";
import { useExport } from "../hooks/useExport";
import { usePreviewPlayback } from "../hooks/usePreviewPlayback";
import { useTrimSettings } from "../hooks/useTrimSettings";
import { useZoomSettings } from "../hooks/useZoomSettings";
import { useState } from "react";

export function EditorApp() {
  const [padding, setPadding] = useState(32);
  const [scalePercent, setScalePercent] = useState(100);
  const [audioGain, setAudioGain] = useState(100);
  const [message, setMessage] = useState("");

  const {
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
  } = useEditorSession({ windowLabel: WINDOW_LABEL_EDITOR });

  const sessionDurationMs = Math.max(lastSession?.durationMs ?? 0, previewDurationMs);

  const zoom = useZoomSettings();
  const trim = useTrimSettings(lastSession);
  const bg = useBackground();

  const playback = usePreviewPlayback(previewUrl, sessionDurationMs);

  const exportHook = useExport({
    maxZoom: zoom.maxZoom,
    zoomInMs: zoom.zoomInMs,
    holdMs: zoom.holdMs,
    zoomOutMs: zoom.zoomOutMs,
    onPreviewUrlChange: setPreviewUrl,
    onPreviewDurationChange: setPreviewDurationMs,
    onSeekToStart: () => playback.setCurrentTimeMs(0),
    onPlaybackStop: () => playback.setIsPlayingPreview(false),
  });

  function updateZoomMarker(markerId: string, startMs: number, endMs: number) {
    setZoomMarkers((prev) =>
      prev.map((marker) =>
        marker.id === markerId
          ? {
              ...marker,
              startMs: Math.min(Math.max(0, startMs), Math.max(sessionDurationMs - 250, 0)),
              endMs: Math.min(Math.max(startMs + 250, endMs), Math.max(sessionDurationMs, startMs + 250)),
            }
          : marker,
      ),
    );
  }

  async function closeEditorWindow() {
    try {
      await getCurrentWindow().hide();
    } catch { /* ignore */ }
  }

  async function minimizeEditorWindow() {
    try {
      await getCurrentWindow().minimize();
    } catch { /* ignore */ }
  }

  async function startNewRecordingFlow() {
    const mainWindow = await WebviewWindow.getByLabel(WINDOW_LABEL_MAIN);
    if (mainWindow) {
      await mainWindow.show();
      await mainWindow.setFocus();
    }
    await getCurrentWebviewWindow().hide();
  }

  async function handleInitGpu() {
    try {
      await exportHook.initializeGpuRenderer();
      setMessage(`GPU renderer ready on ${exportHook.gpuStatus?.backend ?? "unknown"} (${exportHook.gpuStatus?.adapterName ?? "adapter"}).`);
    } catch (error) {
      setMessage(`Could not initialize GPU renderer: ${String(error)}`);
    }
  }

  async function handleGenerateZoomPreview() {
    try {
      await zoom.generateZoomPreview();
      setMessage(`Zoom preview generated.`);
    } catch (error) {
      setMessage(`Could not build zoom preview: ${String(error)}`);
    }
  }

  async function handleExportRecording() {
    try {
      await exportHook.exportRecording();
      setMessage(`Export completed: ${exportHook.lastExport?.outputPath ?? ""}`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function handleOpenExportedFile() {
    try {
      await exportHook.openExportedFile();
    } catch (error) {
      setMessage(`Could not open exported file: ${String(error)}`);
    }
  }

  return (
    <EditorWindow
      headerProps={{
        isExporting: exportHook.isExporting,
        recording,
        sessionFolder: lastSession?.sessionFolder ?? null,
        onCloseWindow: () => void closeEditorWindow(),
        onMinimizeWindow: () => void minimizeEditorWindow(),
        onStartNewRecordingFlow: () => void startNewRecordingFlow(),
        onInitializeGpuRenderer: () => void handleInitGpu(),
        onGenerateZoomPreview: () => void handleGenerateZoomPreview(),
        onExportRecording: () => void handleExportRecording(),
      }}
      previewProps={{
        backgroundStyle: bg.backgroundStyle,
        cameraUrl,
        currentTimeMs: playback.currentTimeMs,
        cursorTrack,
        gpuStatus: exportHook.gpuStatus,
        isPlaying: playback.isPlayingPreview,
        isMuted: playback.isMutedPreview,
        previewUrl,
        sessionDurationMs,
        status,
        scalePercent,
        zoomInMs: zoom.zoomInMs,
        zoomMarkers,
        zoomOutMs: zoom.zoomOutMs,
        maxZoom: zoom.maxZoom,
        onDurationChange: setPreviewDurationMs,
        onSeekBy: playback.seekPreviewBy,
        onTimeChange: playback.setCurrentTimeMs,
        onToggleMute: playback.toggleMutePreview,
        onTogglePlay: () => playback.togglePreviewPlayback(Boolean(previewUrl), sessionDurationMs),
        onPlaybackEnded: () => playback.setIsPlayingPreview(false),
        onVideoError: setMessage,
      }}
      inspectorProps={{
        audioGain,
        backgroundStyle: bg.backgroundStyle,
        backgroundImageFileName: bg.backgroundImageFileName,
        exportPath: exportHook.exportPath,
        holdMs: zoom.holdMs,
        isExporting: exportHook.isExporting,
        lastExportExists: Boolean(exportHook.lastExport),
        maxZoom: zoom.maxZoom,
        padding,
        scalePercent,
        sessionDurationMs,
        trimEndMs: trim.trimEndMs,
        trimStartMs: trim.trimStartMs,
        zoomInMs: zoom.zoomInMs,
        zoomOutMs: zoom.zoomOutMs,
        onSetTrimStartMs: trim.setTrimStartMs,
        onSetTrimEndMs: trim.setTrimEndMs,
        onSetPadding: setPadding,
        onSetScalePercent: setScalePercent,
        onSetMaxZoom: zoom.setMaxZoom,
        onSetZoomInMs: zoom.setZoomInMs,
        onSetHoldMs: zoom.setHoldMs,
        onSetZoomOutMs: zoom.setZoomOutMs,
        onSetAudioGain: setAudioGain,
        onSetExportPath: exportHook.setExportPath,
        onOpenExportedFile: () => void handleOpenExportedFile(),
        onSetBackgroundTab: bg.updateBackgroundTab,
        onSetBackgroundValue: bg.updateBackgroundValue,
        onSetBackgroundBlur: bg.updateBackgroundBlur,
        onSetBackgroundImage: bg.updateBackgroundImage,
      }}
      timelineProps={{
        audioGain,
        currentTimeMs: playback.currentTimeMs,
        durationMs: sessionDurationMs,
        isPlaying: playback.isPlayingPreview,
        padding,
        scalePercent,
        timeline,
        trimEndMs: trim.trimEndMs,
        trimStartMs: trim.trimStartMs,
        zoomPreview: zoom.zoomPreview,
        onSeek: playback.seekPreview,
        onTogglePlay: () => playback.togglePreviewPlayback(Boolean(previewUrl), sessionDurationMs),
        zoomMarkers,
        onMoveZoomMarker: updateZoomMarker,
        onTrimStartChange: trim.setTrimStartMs,
        onTrimEndChange: trim.setTrimEndMs,
      }}
      lastExport={exportHook.lastExport}
      message={message}
    />
  );
}
