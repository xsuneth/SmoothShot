import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { openPath } from "@tauri-apps/plugin-opener";

import { EditorHeader } from "./components/EditorHeader";
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
  GeneratePreviewProxyResponse,
  GpuInitStatus,
  LauncherMode,
  RecordingStatus,
  StopRecordingResponse,
  ZoomMarker,
  ZoomPreviewResponse,
} from "./types";

function detectWindowLabel() {
  try {
    return getCurrentWebviewWindow().label;
  } catch {
    return "main";
  }
}

function initialViewForWindow(label: string): AppView {
  return label === "editor" ? "editor" : "launcher";
}

function App() {
  const [windowLabel] = useState(() => detectWindowLabel());
  const [view, setView] = useState<AppView>(() => initialViewForWindow(windowLabel));
  const [launcherMode, setLauncherMode] = useState<LauncherMode>("display");
  const [recording, setRecording] = useState(false);
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
  const [displaySelection, setDisplaySelection] = useState("auto");
  const [message, setMessage] = useState("");
  const [fps, setFps] = useState(60);
  const [isExporting, setIsExporting] = useState(false);
  const [exportPath, setExportPath] = useState("");
  const [maxZoom, setMaxZoom] = useState(1.85);
  const [zoomInMs, setZoomInMs] = useState(180);
  const [holdMs, setHoldMs] = useState(120);
  const [zoomOutMs, setZoomOutMs] = useState(260);
  const [regionEnabled, setRegionEnabled] = useState(false);
  const [region] = useState<CaptureRegion>({
    x: 100,
    y: 100,
    width: 1280,
    height: 720,
  });
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [appAudioEnabled, setAppAudioEnabled] = useState(true);
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
  const [zoomMarkers, setZoomMarkers] = useState<ZoomMarker[]>([]);
  const [cursorTrack, setCursorTrack] = useState<FrameMetadata[]>([]);
  const [backgroundImageFileName, setBackgroundImageFileName] = useState("");

  const sessionDurationMs = Math.max(lastSession?.durationMs ?? 0, previewDurationMs);
  const canOpenEditor = Boolean(lastSession) || status.framesCaptured > 0;
  const selectedDisplay = displays.find((display) => String(display.index) === displaySelection);
  const selectedDisplayLabel =
    displaySelection === "auto"
      ? "Auto display"
      : selectedDisplay
        ? `${selectedDisplay.isPrimary ? "Primary" : `Display ${selectedDisplay.index + 1}`} ${selectedDisplay.width}x${selectedDisplay.height}`
        : "Selected display";

  useEffect(() => {
    void loadDisplays();

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

    void positionLauncherBar();
  }, [windowLabel]);

  useEffect(() => {
    setRegionEnabled(launcherMode === "area");
  }, [launcherMode]);

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

  function clickEventsToMarkers(clicks: ClickEvent[]): ZoomMarker[] {
    return clicks.slice(-8).map((event, index) => ({
      id: `${event.timestampMs}-${index}`,
      label: "Zoom",
      timeMs: event.timestampMs,
      cursorX: event.cursorX,
      cursorY: event.cursorY,
    }));
  }

  async function loadDisplays() {
    try {
      const availableDisplays = await invoke<DisplayDescriptor[]>("list_displays");
      setDisplays(availableDisplays);
    } catch {
      setDisplays([]);
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
      const y = Math.round(monitorY + monitorHeight - height - 80);
      await win.setPosition(new LogicalPosition(x, y));
    } catch {
      // Ignore positioning failures and keep default placement.
    }
  }

  async function hideLauncher() {
    try {
      await getCurrentWindow().hide();
    } catch {
      // Ignore hide failures.
    }
  }

  function selectLauncherMode(mode: LauncherMode) {
    if (mode === "window" || mode === "device") {
      setMessage(`${mode} capture mode is planned next. Using display capture for now.`);
      setLauncherMode("display");
      return;
    }

    setLauncherMode(mode);
  }

  function cycleDisplaySelection() {
    if (displays.length === 0) {
      return;
    }

    const options = ["auto", ...displays.map((display) => String(display.index))];
    const currentIndex = options.indexOf(displaySelection);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % options.length : 0;
    const nextSelection = options[nextIndex];
    const nextDisplay = displays.find((display) => String(display.index) === nextSelection);
    const nextLabel =
      nextSelection === "auto"
        ? "Auto display"
        : nextDisplay
          ? `${nextDisplay.isPrimary ? "Primary" : `Display ${nextDisplay.index + 1}`} ${nextDisplay.width}x${nextDisplay.height}`
          : "Selected display";

    setDisplaySelection(nextSelection);
    setMessage(`Capture source: ${nextLabel}`);
  }

  async function notifyEditorSessionUpdated() {
    const editorWindow = await WebviewWindow.getByLabel("editor");
    if (editorWindow) {
      await editorWindow.emit("smoothshot:session-updated");
    }
  }

  async function startRecording() {
    try {
      const request = {
        fps,
        region: regionEnabled ? region : null,
        displayIndex: displaySelection === "auto" ? null : Number(displaySelection),
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

  async function stopRecording() {
    try {
      const result = await invoke<StopRecordingResponse>("stop_recording");
      setLastSession(result);
      setRecording(false);
      setTrimStartMs(0);
      setTrimEndMs(result.durationMs);
      setCurrentTimeMs(0);
      setIsPlayingPreview(false);
      const [clicks, frameTrack, nextStatus] = await Promise.all([
        invoke<ClickEvent[]>("get_click_timeline"),
        invoke<FrameMetadata[]>("get_frame_timeline", { limit: 5000 }),
        invoke<RecordingStatus>("get_recording_status"),
      ]);
      setTimeline(clicks.slice(-16).reverse());
      setZoomMarkers(clickEventsToMarkers(clicks));
      setCursorTrack(frameTrack);
      setStatus(nextStatus);
      setPreviewDurationMs(result.durationMs);

      setPreviewUrl(null);
      setMessage("Recording complete. Editor opened with direct frame preview.");
      if (false) {
        try {
          const proxy = await invoke<GeneratePreviewProxyResponse>("generate_preview_proxy");
          setPreviewUrl(toLocalFileUrl(proxy.proxyPath));
          setPreviewDurationMs(proxy.durationMs);
          setMessage("Recording complete. Preview ready – editor opened.");
        } catch {
          setMessage("Recording complete. Editor opened. Export to load preview.");
        }
      } else {
        setPreviewUrl(null);
        setMessage("Recording complete. Editor opened with direct frame preview.");
      }

      await openEditorWindow();
      if (windowLabel === "editor") {
        setView("editor");
      }
      void notifyEditorSessionUpdated();
    } catch (error) {
      setMessage(`Could not stop recording: ${String(error)}`);
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

      setStatus(nextStatus);
      setRecording(nextStatus.isRecording);
      setTimeline(clicks.slice(-16).reverse());
      setZoomMarkers(clickEventsToMarkers(clicks));
      setCursorTrack(frameTrack);

      if (summary) {
        setLastSession(summary);
        setTrimStartMs((prev) => Math.min(prev, summary.durationMs));
        setTrimEndMs((prev) => (prev <= 0 ? summary.durationMs : Math.min(prev, summary.durationMs)));
        setPreviewDurationMs(summary.durationMs);
        setPreviewUrl(null);
      }
    } catch {
      // Ignore refresh errors while editor initializes.
    }
  }

  async function openEditorWindow() {
    if (windowLabel === "editor") {
      setView("editor");
      return;
    }

    const existing = await WebviewWindow.getByLabel("editor");
    if (existing) {
      await existing.show();
      await existing.setFocus();
      await existing.emit("smoothshot:session-updated");
      return;
    }

    const editorWindow = new WebviewWindow("editor", {
      title: "SmoothShot Editor",
      width: 1280,
      height: 860,
      minWidth: 980,
      minHeight: 680,
      center: true,
      focus: true,
    });

    editorWindow.once("tauri://created", async () => {
      await editorWindow.emit("smoothshot:session-updated");
    });

    editorWindow.once("tauri://error", (event) => {
      setMessage(`Could not open editor window: ${String(event.payload)}`);
    });
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
    const normalized = path.replace(/\\/g, "/");
    if (/^[A-Za-z]:\//.test(normalized)) {
      return `file:///${normalized}`;
    }

    if (normalized.startsWith("/")) {
      return `file://${normalized}`;
    }

    return normalized;
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

  function updateZoomMarker(markerId: string, timeMs: number) {
    setZoomMarkers((prev) =>
      prev.map((marker) =>
        marker.id === markerId
          ? { ...marker, timeMs: Math.min(Math.max(0, timeMs), Math.max(sessionDurationMs, 1000)) }
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
        launcherMode={launcherMode}
        displays={displays}
        displaySelection={displaySelection}
        selectedDisplayLabel={selectedDisplayLabel}
        fps={fps}
        region={region}
        cameraEnabled={cameraEnabled}
        micEnabled={micEnabled}
        appAudioEnabled={appAudioEnabled}
        recording={recording}
        canOpenEditor={canOpenEditor}
        onHide={hideLauncher}
        onSelectMode={selectLauncherMode}
        onCycleDisplaySelection={cycleDisplaySelection}
        onSetFps={setFps}
        onToggleCamera={() => setCameraEnabled((prev) => !prev)}
        onToggleMic={() => void toggleMic()}
        onToggleAppAudio={() => void toggleAppAudio()}
        onOpenEditor={() => void openEditorWindow()}
        onStartRecording={() => void startRecording()}
        onStopRecording={() => void stopRecording()}
        onShowSourceInfo={() =>
          setMessage(`Source: ${selectedDisplayLabel}${launcherMode === "area" ? ` | Area ${region.width}x${region.height}` : ""}`)
        }
      />
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#05060b] text-white">
      <EditorHeader
        isExporting={isExporting}
        recording={recording}
        sessionFolder={lastSession?.sessionFolder ?? null}
        onStartNewRecordingFlow={() => void startNewRecordingFlow()}
        onInitializeGpuRenderer={() => void initializeGpuRenderer()}
        onGenerateZoomPreview={() => void generateZoomPreview()}
        onExportRecording={() => void exportRecording()}
      />

      <section className="grid min-h-[calc(100vh-56px-210px)] grid-cols-[minmax(0,1fr)_320px]">
        <EditorPreview
          backgroundStyle={backgroundStyle}
          currentTimeMs={currentTimeMs}
          cursorTrack={cursorTrack}
          gpuStatus={gpuStatus}
          isPlaying={isPlayingPreview}
          previewUrl={previewUrl}
          sessionDurationMs={sessionDurationMs}
          status={status}
          scalePercent={scalePercent}
          trimEndMs={trimEndMs}
          trimStartMs={trimStartMs}
          zoomInMs={zoomInMs}
          zoomMarkers={zoomMarkers}
          zoomOutMs={zoomOutMs}
          maxZoom={maxZoom}
          holdMs={holdMs}
          onDurationChange={setPreviewDurationMs}
          onSeekBy={seekPreviewBy}
          onTimeChange={setCurrentTimeMs}
          onTogglePlay={togglePreviewPlayback}
          onPlaybackEnded={() => setIsPlayingPreview(false)}
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

      <p className="px-4 py-2 text-[0.82rem] text-[#8f9bb8]">{message}</p>
    </main>
  );
}

export default App;
