import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { openPath } from "@tauri-apps/plugin-opener";

import { EditorHeader } from "./components/EditorHeader";
import { DisplayPickerWindow } from "./components/DisplayPickerWindow";
import { EditorInspector } from "./components/EditorInspector";
import { EditorPreview } from "./components/EditorPreview";
import { ExportResult } from "./components/ExportResult";
import { LauncherBar } from "./components/LauncherBar";
import { TimelinePanel } from "./components/TimelinePanel";
import type {
  AppView,
  AudioConfig,
  BackgroundStyle,
  CaptureRegion,
  ClickEvent,
  DisplayDescriptor,
  ExportRecordingResponse,
  FrameMetadata,
  GpuInitStatus,
  InputDeviceOption,
  LauncherMode,
  RecordingStatus,
  StopRecordingResponse,
  ZoomMarker,
  ZoomPreviewResponse,
} from "./types";

function getWindowHintFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const hint = params.get("window");
  if (hint === "main" || hint === "editor" || hint === "display-picker") {
    return hint;
  }

  return null;
}

function detectWindowLabel() {
  const hintedLabel = getWindowHintFromUrl();
  if (hintedLabel) {
    return hintedLabel;
  }

  try {
    return getCurrentWebviewWindow().label;
  } catch {
    try {
      return getCurrentWindow().label;
    } catch {
      return "main";
    }
  }
}

function initialViewForWindow(label: string): AppView {
  if (label === "editor") {
    return "editor";
  }

  if (label === "display-picker") {
    return "displayPicker";
  }

  return "launcher";
}

const DISPLAY_PICKER_GAP = 4;
const DISPLAY_CARD_WIDTH = 240;
const DISPLAY_CARD_HEIGHT = 92;
const DISPLAY_PICKER_GRID_GAP = 12;
const DISPLAY_PICKER_FRAME_WIDTH = 24;
const DISPLAY_PICKER_FRAME_HEIGHT = 24;

function getDisplayPickerSize(displayCount: number) {
  const safeCount = Math.max(displayCount, 1);
  const columns = safeCount === 1 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(safeCount / 2));
  return {
    width: columns * DISPLAY_CARD_WIDTH + (columns - 1) * DISPLAY_PICKER_GRID_GAP + DISPLAY_PICKER_FRAME_WIDTH,
    height: rows * DISPLAY_CARD_HEIGHT + (rows - 1) * DISPLAY_PICKER_GRID_GAP + DISPLAY_PICKER_FRAME_HEIGHT,
  };
}

function App() {
  const [windowLabel] = useState(() => detectWindowLabel());
  const [view, setView] = useState<AppView>(() => initialViewForWindow(windowLabel));
  const [launcherMode, setLauncherMode] = useState<LauncherMode | null>(null);
  const [recording, setRecording] = useState(false);
  const [launcherVisible, setLauncherVisible] = useState(false);
  const [isDisplayPickerOpen, setIsDisplayPickerOpen] = useState(false);
  const [status, setStatus] = useState<RecordingStatus>({
    isRecording: false,
    targetFps: 60,
    framesCaptured: 0,
    clicksDetected: 0,
  });
  const [lastSession, setLastSession] = useState<StopRecordingResponse | null>(null);
  const [timeline, setTimeline] = useState<ClickEvent[]>([]);
  const [gpuStatus, setGpuStatus] = useState<GpuInitStatus | null>(null);
  const [zoomPreview, setZoomPreview] = useState<ZoomPreviewResponse | null>(null);
  const [lastExport, setLastExport] = useState<ExportRecordingResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [displays, setDisplays] = useState<DisplayDescriptor[]>([]);
  const [displayPickerLoading, setDisplayPickerLoading] = useState(false);
  const [displaySelection, setDisplaySelection] = useState("");
  const [message, setMessage] = useState("");
  const [fps] = useState(60);
  const [isExporting, setIsExporting] = useState(false);
  const [exportPath, setExportPath] = useState("");
  const [maxZoom, setMaxZoom] = useState(1.85);
  const [zoomInMs, setZoomInMs] = useState(180);
  const [holdMs, setHoldMs] = useState(120);
  const [zoomOutMs, setZoomOutMs] = useState(260);
  const [region] = useState<CaptureRegion>({
    x: 100,
    y: 100,
    width: 1280,
    height: 720,
  });
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [appAudioEnabled, setAppAudioEnabled] = useState(true);
  const [cameraDevices, setCameraDevices] = useState<InputDeviceOption[]>([]);
  const [microphoneDevices, setMicrophoneDevices] = useState<InputDeviceOption[]>([]);
  const [selectedCameraDevice, setSelectedCameraDevice] = useState<string | null>(null);
  const [selectedMicrophoneDevice, setSelectedMicrophoneDevice] = useState<string | null>(null);
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(0);
  const [padding, setPadding] = useState(32);
  const [scalePercent, setScalePercent] = useState(100);
  const [audioGain, setAudioGain] = useState(100);
  const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyle>({
    tab: "wallpaper",
    value: "macos",
    blur: 0,
  });
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [previewDurationMs, setPreviewDurationMs] = useState(0);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isMutedPreview, setIsMutedPreview] = useState(false);
  const [micInputLevel, setMicInputLevel] = useState(0);
  const [zoomMarkers, setZoomMarkers] = useState<ZoomMarker[]>([]);
  const [cursorTrack, setCursorTrack] = useState<FrameMetadata[]>([]);
  const [backgroundImageFileName, setBackgroundImageFileName] = useState("");

  const sessionDurationMs = Math.max(lastSession?.durationMs ?? 0, previewDurationMs);
  const selectedDisplay = displays.find((display) => String(display.index) === displaySelection);
  const selectedDisplayLabel =
    selectedDisplay
      ? `${selectedDisplay.isPrimary ? "Primary" : `Display ${selectedDisplay.index + 1}`} ${selectedDisplay.width}x${selectedDisplay.height}`
      : "Display not selected";
  const selectedCameraLabel =
    cameraDevices.find((device) => device.id === selectedCameraDevice)?.name ?? cameraDevices[0]?.name ?? "Camera";
  const selectedMicrophoneLabel =
    microphoneDevices.find((device) => device.id === selectedMicrophoneDevice)?.name ?? microphoneDevices[0]?.name ?? "Microphone";

  useEffect(() => {
    void loadDisplays();
    void loadInputDevices();

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

  useEffect(() => {
    if (windowLabel !== "main") {
      return;
    }

    let unlistenMic: (() => void) | undefined;
    void getCurrentWebviewWindow()
      .listen<number>("mic-level", (event) => {
        setMicInputLevel(Math.min(1, Math.max(0, Number(event.payload) || 0)));
      })
      .then((dispose) => {
        unlistenMic = dispose;
      });

    return () => {
      unlistenMic?.();
    };
  }, [windowLabel]);

  useEffect(() => {
    if (windowLabel !== "editor") {
      return;
    }

    void refreshEditorSessionData();

    let unlisten: (() => void) | undefined;
    void getCurrentWebviewWindow()
      .listen("smoothshot:session-updated", () => {
        void refreshEditorSessionData();
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        // Ignore listener registration issues on startup.
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [windowLabel]);

  useEffect(() => {
    if (windowLabel !== "main") {
      return;
    }

    void showLauncherWindow(true);
  }, [windowLabel]);

  useEffect(() => {
    if (windowLabel !== "main") {
      return;
    }

    let unlistenSelect: (() => void) | undefined;
    let unlistenRecord: (() => void) | undefined;
    let unlistenMoved: (() => void) | undefined;
    let unlistenClosed: (() => void) | undefined;

    void getCurrentWebviewWindow()
      .listen<string>("smoothshot:display-picker-select", async (event) => {
        selectDisplaySelection(event.payload);
        const popup = await WebviewWindow.getByLabel("display-picker");
        if (popup) {
          await popup.hide();
        }
        setIsDisplayPickerOpen(false);
      })
      .then((dispose) => {
        unlistenSelect = dispose;
      });

    void getCurrentWebviewWindow()
      .listen<string>("smoothshot:display-picker-record", async (event) => {
        selectDisplaySelection(event.payload);
        setLauncherMode("display");
        const popup = await WebviewWindow.getByLabel("display-picker");
        if (popup) {
          await popup.hide();
        }
        setIsDisplayPickerOpen(false);
        await startRecording();
      })
      .then((dispose) => {
        unlistenRecord = dispose;
      });

    void getCurrentWebviewWindow()
      .listen("smoothshot:display-picker-closed", () => {
        setIsDisplayPickerOpen(false);
      })
      .then((dispose) => {
        unlistenClosed = dispose;
      });

    void getCurrentWindow()
      .onMoved(async () => {
        await hideDisplayPopup();
      })
      .then((dispose) => {
        unlistenMoved = dispose;
      });

    return () => {
      unlistenSelect?.();
      unlistenRecord?.();
      unlistenMoved?.();
      unlistenClosed?.();
    };
  }, [windowLabel, displays, displaySelection, fps, launcherMode]);

  useEffect(() => {
    if (windowLabel !== "display-picker") {
      return;
    }

    let unlisten: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    void getCurrentWebviewWindow()
      .listen<{ displaySelection: string; displays: DisplayDescriptor[]; isLoading: boolean }>("smoothshot:display-picker-data", (event) => {
        setDisplaySelection(event.payload.displaySelection);
        setDisplays(event.payload.displays);
        setDisplayPickerLoading(event.payload.isLoading);
      })
      .then((dispose) => {
        unlisten = dispose;
      });

    void getCurrentWindow()
      .onFocusChanged(async ({ payload: focused }) => {
        if (!focused) {
          await getCurrentWindow().hide().catch(() => {
            // Ignore popup hide failures.
          });
          await getCurrentWebviewWindow().emitTo("main", "smoothshot:display-picker-closed").catch(() => {
            // Ignore close sync failures.
          });
        }
      })
      .then((dispose) => {
        unlistenFocus = dispose;
      });

    return () => {
      unlisten?.();
      unlistenFocus?.();
    };
  }, [windowLabel]);

  useEffect(() => {
    return () => {
      if (backgroundStyle.tab === "image" && backgroundStyle.value.startsWith("blob:")) {
        URL.revokeObjectURL(backgroundStyle.value);
      }
    };
  }, [backgroundStyle]);

  useEffect(() => {
    if (!isPlayingPreview || previewUrl) {
      return;
    }

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

  function clickEventsToMarkers(clicks: ClickEvent[], durationMs: number): ZoomMarker[] {
    const leftClicks = clicks
      .filter((event) => event.button === "left")
      .sort((a, b) => a.timestampMs - b.timestampMs);
    const doubleClickThresholdMs = 320;
    const toggleMoments: number[] = [];

    for (let index = 1; index < leftClicks.length; index += 1) {
      const previous = leftClicks[index - 1];
      const current = leftClicks[index];
      if (current.timestampMs - previous.timestampMs <= doubleClickThresholdMs) {
        toggleMoments.push(current.timestampMs);
        index += 1;
      }
    }

    const markers: ZoomMarker[] = [];
    for (let index = 0; index < toggleMoments.length; index += 2) {
      const startMs = toggleMoments[index];
      const endMs = toggleMoments[index + 1] ?? durationMs;
      if (endMs <= startMs) {
        continue;
      }

      markers.push({
        id: `zoom-range-${index}`,
        label: "Zoom",
        startMs,
        endMs,
      });
    }

    return markers;
  }

  function normalizeSessionTiming(clicks: ClickEvent[], frameTrack: FrameMetadata[]) {
    const firstFrameTime = frameTrack[0]?.timestampMs ?? Number.POSITIVE_INFINITY;
    const firstClickTime = clicks[0]?.timestampMs ?? Number.POSITIVE_INFINITY;
    const zeroPoint = Math.min(firstFrameTime, firstClickTime);

    if (!Number.isFinite(zeroPoint) || zeroPoint <= 0) {
      return { clicks, frameTrack };
    }

    return {
      clicks: clicks.map((event) => ({
        ...event,
        timestampMs: Math.max(0, event.timestampMs - zeroPoint),
      })),
      frameTrack: frameTrack.map((frame) => ({
        ...frame,
        timestampMs: Math.max(0, frame.timestampMs - zeroPoint),
      })),
    };
  }

  async function loadDisplays() {
    setDisplayPickerLoading(true);
    try {
      const availableDisplays = await invoke<DisplayDescriptor[]>("list_displays");
      setDisplays(availableDisplays);
      setDisplaySelection((previousSelection) => {
        if (availableDisplays.some((display) => String(display.index) === previousSelection)) {
          return previousSelection;
        }

        const firstDisplay = availableDisplays[0];
        return firstDisplay ? String(firstDisplay.index) : "";
      });
      return availableDisplays;
    } catch {
      setDisplays([]);
      setDisplaySelection("");
      return [];
    } finally {
      setDisplayPickerLoading(false);
    }
  }

  async function positionLauncherBar() {
    try {
      const win = getCurrentWindow();
      const monitor = await currentMonitor();
      if (!monitor) {
        return;
      }

      const windowSize = await win.innerSize();
      const scale = monitor.scaleFactor || 1;
      const monitorX = monitor.position.x / scale;
      const monitorY = monitor.position.y / scale;
      const monitorWidth = monitor.size.width / scale;
      const monitorHeight = monitor.size.height / scale;
      const width = windowSize.width / scale;
      const height = windowSize.height / scale;

      const x = Math.round(monitorX + (monitorWidth - width) / 2);
      const y = Math.round(monitorY + monitorHeight - height - 40);
      await win.setPosition(new LogicalPosition(x, y));
    } catch {
      // Ignore positioning failures and keep default placement.
    }
  }

  async function loadInputDevices() {
    try {
      const [cameraNames, microphoneNames] = await Promise.all([
        invoke<string[]>("list_camera_devices"),
        invoke<string[]>("list_microphone_devices"),
      ]);

      const nextCameras = cameraNames.map((name) => ({ id: name, name }));
      const nextMics = microphoneNames.map((name) => ({ id: name, name }));
      setCameraDevices(nextCameras);
      setMicrophoneDevices(nextMics);
      setSelectedCameraDevice((prev) => prev ?? nextCameras[0]?.id ?? null);
      setSelectedMicrophoneDevice((prev) => prev ?? nextMics[0]?.id ?? null);
    } catch {
      setCameraDevices([]);
      setMicrophoneDevices([]);
    }
  }

  async function showLauncherWindow(animate = false) {
    if (windowLabel !== "main") {
      return;
    }

    try {
      const win = getCurrentWindow();
      setLauncherVisible(false);
      await positionLauncherBar();
      await win.show();
      if (animate) {
        window.setTimeout(() => setLauncherVisible(true), 24);
      } else {
        setLauncherVisible(true);
      }
    } catch {
      setLauncherVisible(true);
    }
  }

  async function hideLauncher() {
    try {
      await hideDisplayPopup();
      setLauncherVisible(false);
      await new Promise((resolve) => window.setTimeout(resolve, 140));
      await getCurrentWindow().hide();
    } catch {
      // Ignore hide failures.
    }
  }

  async function closeEditorWindow() {
    try {
      await getCurrentWindow().hide();
    } catch {
      // Ignore close failures.
    }
  }

  async function minimizeEditorWindow() {
    try {
      await getCurrentWindow().minimize();
    } catch {
      // Ignore minimize failures.
    }
  }

  function selectLauncherMode(mode: LauncherMode) {
    if (mode === "window") {
      setMessage(`${mode} capture mode is planned next. Using display capture for now.`);
      return;
    }

    setLauncherMode(mode);
  }

  function selectDisplaySelection(selection: string) {
    const nextDisplay = displays.find((display) => String(display.index) === selection);
    const nextLabel =
      nextDisplay
        ? `${nextDisplay.isPrimary ? "Primary" : `Display ${nextDisplay.index + 1}`} ${nextDisplay.width}x${nextDisplay.height}`
        : "Selected display";

    setDisplaySelection(selection);
    setMessage(`Capture source: ${nextLabel}`);
  }

  async function hideDisplayPopup() {
    setIsDisplayPickerOpen(false);
    const popup = await WebviewWindow.getByLabel("display-picker");
    if (popup) {
      await popup.hide().catch(() => {
        // Ignore popup hide failures.
      });
    }
  }

  async function startRecording() {
    try {
      await hideDisplayPopup();
      const effectiveMode = launcherMode ?? "display";
      const request = {
        fps,
        region: effectiveMode === "area" ? region : null,
        displayIndex: displaySelection.length > 0 ? Number(displaySelection) : null,
      };
      const nextStatus = await invoke<RecordingStatus>("start_recording", { request });
      setStatus(nextStatus);
      setRecording(true);
      setLastSession(null);
      setTimeline([]);
      setZoomMarkers([]);
      setCursorTrack([]);
      setPreviewUrl(null);
      setCurrentTimeMs(0);
      setPreviewDurationMs(0);
      setIsPlayingPreview(false);
      setMessage("Recording started. Click naturally to generate zoom markers.");
    } catch (error) {
      setMessage(`Could not start recording: ${String(error)}`);
    }
  }

  async function refreshEditorSessionData() {
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
        setTrimStartMs((prev) => Math.min(prev, summary.durationMs));
        setTrimEndMs((prev) => (prev <= 0 ? summary.durationMs : Math.min(prev, summary.durationMs)));
        setPreviewDurationMs(summary.durationMs);
        setPreviewUrl(summary.sourceVideoPath ? toLocalFileUrl(summary.sourceVideoPath) : null);
      }
    } catch {
      // Ignore refresh errors while editor initializes.
    }
  }

  async function exportRecording() {
    try {
      setIsExporting(true);
      const exportResult = await invoke<ExportRecordingResponse>("export_recording_cmd", {
        request: {
          outputPath: exportPath.trim().length > 0 ? exportPath.trim() : null,
          maxZoom,
          zoomInMs,
          holdMs,
          zoomOutMs,
        },
      });
      setLastExport(exportResult);
      setPreviewUrl(toLocalFileUrl(exportResult.outputPath));
      setPreviewDurationMs(exportResult.outputDurationMs);
      setCurrentTimeMs(0);
      setIsPlayingPreview(false);
      setMessage(`Export completed: ${exportResult.outputPath}`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setIsExporting(false);
    }
  }

  function toLocalFileUrl(path: string) {
    return convertFileSrc(path);
  }

  async function showDisplayMenu(anchorX: number, anchorY: number) {
    void anchorX;
    void anchorY;
    setDisplayPickerLoading(true);

    try {
      const currentWindow = getCurrentWindow();
      const windowPosition = await currentWindow.outerPosition();
      const windowSize = await currentWindow.outerSize();
      const popupSize = getDisplayPickerSize(Math.max(1, displays.length));
      const toPopupPosition = (size: { width: number; height: number }) => ({
        x: Math.round(windowPosition.x + (windowSize.width - size.width) / 2),
        y: Math.round(windowPosition.y - size.height - DISPLAY_PICKER_GAP),
      });
      const initialPosition = toPopupPosition(popupSize);

      let popup = await WebviewWindow.getByLabel("display-picker");

      if (popup) {
        const isVisible = await popup.isVisible().catch(() => false);
        if (isVisible) {
          await hideDisplayPopup();
          return;
        }
      }

      if (!popup) {
        new WebviewWindow("display-picker", {
          url: "/?window=display-picker",
          title: "Display Picker",
          width: popupSize.width,
          height: popupSize.height,
          minWidth: popupSize.width,
          minHeight: popupSize.height,
          maxWidth: popupSize.width,
          maxHeight: popupSize.height,
          decorations: false,
          transparent: true,
          shadow: false,
          alwaysOnTop: true,
          focus: true,
          visible: false,
          skipTaskbar: true,
          resizable: false,
        });

        for (let attempt = 0; attempt < 40; attempt += 1) {
          popup = await WebviewWindow.getByLabel("display-picker");
          if (popup) {
            break;
          }

          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 50);
          });
        }

        if (!popup) {
          throw new Error("display-picker window was not created");
        }
      }

      await popup.setSize(new LogicalSize(popupSize.width, popupSize.height));
      await popup.setPosition(new PhysicalPosition(initialPosition.x, initialPosition.y));
      await popup.show();
      await popup.setFocus();
      setIsDisplayPickerOpen(true);

      await popup.emit("smoothshot:display-picker-data", {
        displaySelection,
        displays,
        isLoading: true,
      });
      const refreshedDisplays = await loadDisplays();
      const refreshedSize = getDisplayPickerSize(refreshedDisplays.length);
      const refreshedPosition = toPopupPosition(refreshedSize);
      await popup.setSize(new LogicalSize(refreshedSize.width, refreshedSize.height));
      await popup.setPosition(new PhysicalPosition(refreshedPosition.x, refreshedPosition.y));
      await popup.emit("smoothshot:display-picker-data", {
        displaySelection,
        displays: refreshedDisplays,
        isLoading: false,
      });
    } catch (error) {
      setIsDisplayPickerOpen(false);
      setMessage(`Could not open display picker: ${String(error)}`);
    } finally {
      setDisplayPickerLoading(false);
    }
  }

  async function showCameraMenu(anchorX: number, anchorY: number) {
    const items = cameraDevices.length > 0
      ? cameraDevices.map((device) => ({
          id: `camera:${device.id}`,
          text: `${device.name}${selectedCameraDevice === device.id ? "  (selected)" : ""}`,
          action: () => {
            setSelectedCameraDevice(device.id);
            setCameraEnabled(true);
            setMessage(`Camera source: ${device.name}`);
          },
        }))
      : [{ id: "camera:none", text: "No camera devices found", enabled: false }];

    const menu = await Menu.new({
      items: [
        ...items,
        {
          id: "camera:toggle",
          text: cameraEnabled ? "Disable Camera" : "Enable Camera",
          action: () => {
            setCameraEnabled((prev) => {
              const next = !prev;
              setMessage(next ? `Camera enabled${selectedCameraDevice ? `: ${selectedCameraDevice}` : ""}` : "Camera disabled");
              return next;
            });
          },
        },
      ],
    });

    await menu.popup(new LogicalPosition(anchorX - 36, anchorY - 60), getCurrentWindow());
  }

  async function showMicMenu(anchorX: number, anchorY: number) {
    const items = microphoneDevices.length > 0
      ? microphoneDevices.map((device) => ({
          id: `mic:${device.id}`,
          text: `${device.name}${selectedMicrophoneDevice === device.id ? "  (selected)" : ""}`,
          action: () => {
            setSelectedMicrophoneDevice(device.id);
            if (!micEnabled) {
              void toggleMic();
            }
            setMessage(`Microphone source: ${device.name}`);
          },
        }))
      : [{ id: "mic:none", text: "No microphone devices found", enabled: false }];

    const menu = await Menu.new({
      items: [
        ...items,
        {
          id: "mic:toggle",
          text: micEnabled ? "Disable microphone" : "Enable microphone",
          action: () => {
            void toggleMic();
          },
        },
      ],
    });

    await menu.popup(new LogicalPosition(anchorX - 40, anchorY - 46), getCurrentWindow());
  }

  async function openExportedFile() {
    if (!lastExport) {
      return;
    }

    try {
      await openPath(lastExport.outputPath);
    } catch (error) {
      setMessage(`Could not open exported file: ${String(error)}`);
    }
  }

  async function initializeGpuRenderer() {
    try {
      const next = await invoke<GpuInitStatus>("initialize_gpu_renderer");
      setGpuStatus(next);
      setMessage(`GPU renderer ready on ${next.backend ?? "unknown"} (${next.adapterName ?? "adapter"}).`);
    } catch (error) {
      setMessage(`Could not initialize GPU renderer: ${String(error)}`);
    }
  }

  async function generateZoomPreview() {
    try {
      const preview = await invoke<ZoomPreviewResponse>("build_zoom_preview", {
        request: {
          limit: 420,
          zoomInMs,
          holdMs,
          zoomOutMs,
          maxZoom,
        },
      });
      setZoomPreview(preview);
      setMessage(`Zoom preview generated from ${preview.clickCount} click events.`);
    } catch (error) {
      setMessage(`Could not build zoom preview: ${String(error)}`);
    }
  }

  async function toggleMic() {
    try {
      const next = !micEnabled;
      setMicEnabled(next);
      await invoke("set_audio_config", {
        config: {
          systemAudioEnabled: appAudioEnabled,
          micEnabled: next,
          systemAudioGain: 1.0,
          micGain: 1.0,
        } satisfies AudioConfig,
      });
    } catch {
      // Revert on error.
      setMicEnabled((prev) => !prev);
    }
  }

  async function toggleAppAudio() {
    try {
      const next = !appAudioEnabled;
      setAppAudioEnabled(next);
      await invoke("set_audio_config", {
        config: {
          systemAudioEnabled: next,
          micEnabled: micEnabled,
          systemAudioGain: 1.0,
          micGain: 1.0,
        } satisfies AudioConfig,
      });
    } catch {
      // Revert on error.
      setAppAudioEnabled((prev) => !prev);
    }
  }

  async function startNewRecordingFlow() {
    if (windowLabel === "editor") {
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
      }

      setLauncherVisible(false);
      window.setTimeout(() => setLauncherVisible(true), 24);
      await getCurrentWebviewWindow().hide();
      return;
    }

    setView("launcher");
    setLastExport(null);
    setPreviewUrl(null);
    setCursorTrack([]);
    setCurrentTimeMs(0);
    setPreviewDurationMs(0);
    setIsPlayingPreview(false);
    setMessage("Back to launcher. Configure and start a new recording.");
  }

  function seekPreview(timeMs: number) {
    setCurrentTimeMs(Math.min(Math.max(0, timeMs), Math.max(sessionDurationMs, 0)));
  }

  function seekPreviewBy(deltaMs: number) {
    seekPreview(currentTimeMs + deltaMs);
  }

  function togglePreviewPlayback() {
    if (!previewUrl && sessionDurationMs <= 0) {
      setMessage("No recorded session is loaded yet.");
      return;
    }

    setIsPlayingPreview((prev) => !prev);
  }

  function updateBackgroundTab(tab: BackgroundStyle["tab"]) {
    setBackgroundStyle((prev) => {
      if (prev.tab === tab) {
        return prev;
      }

      const nextValue =
        tab === "wallpaper" ? "macos" :
        tab === "gradient" ? "aurora" :
        tab === "color" ? "midnight" :
        "";

      return {
        ...prev,
        tab,
        value: nextValue,
      };
    });
  }

  function updateZoomMarker(markerId: string, startMs: number, endMs: number) {
    setZoomMarkers((prev) =>
      prev.map((marker) =>
        marker.id === markerId
          ? {
              ...marker,
              startMs: Math.min(Math.max(0, startMs), Math.max(sessionDurationMs - 250, 0)),
              endMs: Math.min(
                Math.max(startMs + 250, endMs),
                Math.max(sessionDurationMs, startMs + 250),
              ),
            }
          : marker,
      ),
    );
  }

  function updateBackgroundImage(file: File | null) {
    if (!file) {
      return;
    }

    setBackgroundStyle((prev) => {
      if (prev.tab === "image" && prev.value.startsWith("blob:")) {
        URL.revokeObjectURL(prev.value);
      }

      return {
        ...prev,
        tab: "image",
        value: URL.createObjectURL(file),
      };
    });
    setBackgroundImageFileName(file.name);
  }

  if (view === "launcher") {
    return (
      <LauncherBar
        isVisible={launcherVisible}
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
        onShowSourceInfo={() =>
          setMessage(`Source: ${selectedDisplayLabel}${launcherMode === "area" ? ` | Area ${region.width}x${region.height}` : ""}`)
        }
      />
    );
  }

  if (view === "displayPicker") {
    return (
      <DisplayPickerWindow
        displays={displays}
        displaySelection={displaySelection}
        isLoading={displayPickerLoading}
        onSelect={(selection) => {
          void getCurrentWebviewWindow()
            .emitTo("main", "smoothshot:display-picker-select", selection)
            .then(async () => {
              await getCurrentWebviewWindow().hide();
              await getCurrentWebviewWindow().emitTo("main", "smoothshot:display-picker-closed");
            })
            .catch(() => {
              // Ignore popup dispatch failures.
            });
        }}
      />
    );
  }

  return (
    <main className="grid h-screen grid-rows-[56px_minmax(0,1fr)_auto_auto] overflow-hidden bg-[#05060b] text-white">
      <EditorHeader
        isExporting={isExporting}
        recording={recording}
        sessionFolder={lastSession?.sessionFolder ?? null}
        onCloseWindow={() => void closeEditorWindow()}
        onMinimizeWindow={() => void minimizeEditorWindow()}
        onStartNewRecordingFlow={() => void startNewRecordingFlow()}
        onInitializeGpuRenderer={() => void initializeGpuRenderer()}
        onGenerateZoomPreview={() => void generateZoomPreview()}
        onExportRecording={() => void exportRecording()}
      />

      <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] overflow-hidden max-[1120px]:grid-cols-1">
        <EditorPreview
          backgroundStyle={backgroundStyle}
          currentTimeMs={currentTimeMs}
          cursorTrack={cursorTrack}
          gpuStatus={gpuStatus}
          isPlaying={isPlayingPreview}
          isMuted={isMutedPreview}
          previewUrl={previewUrl}
          sessionDurationMs={sessionDurationMs}
          status={status}
          scalePercent={scalePercent}
          zoomInMs={zoomInMs}
          zoomMarkers={zoomMarkers}
          zoomOutMs={zoomOutMs}
          maxZoom={maxZoom}
          onDurationChange={setPreviewDurationMs}
          onSeekBy={seekPreviewBy}
          onTimeChange={setCurrentTimeMs}
          onToggleMute={() => setIsMutedPreview((prev) => !prev)}
          onTogglePlay={togglePreviewPlayback}
          onPlaybackEnded={() => setIsPlayingPreview(false)}
          onVideoError={(nextMessage) => setMessage(nextMessage)}
        />
        <EditorInspector
          audioGain={audioGain}
          backgroundStyle={backgroundStyle}
          backgroundImageFileName={backgroundImageFileName}
          exportPath={exportPath}
          holdMs={holdMs}
          isExporting={isExporting}
          lastExportExists={Boolean(lastExport)}
          maxZoom={maxZoom}
          padding={padding}
          scalePercent={scalePercent}
          sessionDurationMs={sessionDurationMs}
          trimEndMs={trimEndMs}
          trimStartMs={trimStartMs}
          zoomInMs={zoomInMs}
          zoomOutMs={zoomOutMs}
          onSetTrimStartMs={setTrimStartMs}
          onSetTrimEndMs={setTrimEndMs}
          onSetPadding={setPadding}
          onSetScalePercent={setScalePercent}
          onSetMaxZoom={setMaxZoom}
          onSetZoomInMs={setZoomInMs}
          onSetHoldMs={setHoldMs}
          onSetZoomOutMs={setZoomOutMs}
          onSetAudioGain={setAudioGain}
          onSetExportPath={setExportPath}
          onOpenExportedFile={() => void openExportedFile()}
          onSetBackgroundTab={updateBackgroundTab}
          onSetBackgroundValue={(value) => setBackgroundStyle((prev) => ({ ...prev, value }))}
          onSetBackgroundBlur={(value) => setBackgroundStyle((prev) => ({ ...prev, blur: value }))}
          onSetBackgroundImage={updateBackgroundImage}
        />
      </section>

      <TimelinePanel
        audioGain={audioGain}
        currentTimeMs={currentTimeMs}
        durationMs={sessionDurationMs}
        isPlaying={isPlayingPreview}
        padding={padding}
        scalePercent={scalePercent}
        timeline={timeline}
        trimEndMs={trimEndMs}
        trimStartMs={trimStartMs}
        zoomPreview={zoomPreview}
        onSeek={seekPreview}
        onTogglePlay={togglePreviewPlayback}
        zoomMarkers={zoomMarkers}
        onMoveZoomMarker={updateZoomMarker}
        onTrimStartChange={setTrimStartMs}
        onTrimEndChange={setTrimEndMs}
      />

      {lastExport && <ExportResult lastExport={lastExport} />}

      <p className="shrink-0 px-4 py-2 text-[0.82rem] text-[#8f9bb8]">{message}</p>
    </main>
  );
}

export default App;
