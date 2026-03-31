import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openPath } from "@tauri-apps/plugin-opener";
import "./App.css";

type CaptureRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RecordingStatus = {
  isRecording: boolean;
  targetFps: number;
  framesCaptured: number;
  clicksDetected: number;
};

type StopRecordingResponse = {
  targetFps: number;
  durationMs: number;
  framesCaptured: number;
  clicksDetected: number;
};

type ClickEvent = {
  timestampMs: number;
  cursorX: number;
  cursorY: number;
  button: string;
};

type GpuInitStatus = {
  initialized: boolean;
  adapterName: string | null;
  backend: string | null;
};

type ZoomProfile = {
  zoomInMs: number;
  holdMs: number;
  zoomOutMs: number;
  maxZoom: number;
  easing: string;
};

type ZoomTransformFrame = {
  frameIndex: number;
  timestampMs: number;
  zoom: number;
  focusX: number;
  focusY: number;
  clickDriven: boolean;
};

type ZoomPreviewResponse = {
  frames: ZoomTransformFrame[];
  clickCount: number;
  profile: ZoomProfile;
};

type ExportRecordingResponse = {
  outputPath: string;
  framesExported: number;
  width: number;
  height: number;
  targetFps: number;
  outputDurationMs: number;
};

type DisplayDescriptor = {
  index: number;
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isPrimary: boolean;
  scaleFactor: number;
  frequency: number;
};

type LauncherMode = "display" | "window" | "area" | "device";
type AppView = "launcher" | "editor";

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
  const [message, setMessage] = useState("Ready for capture.");
  const [fps, setFps] = useState(60);
  const [isExporting, setIsExporting] = useState(false);
  const [exportPath, setExportPath] = useState("");
  const [maxZoom, setMaxZoom] = useState(1.85);
  const [zoomInMs, setZoomInMs] = useState(180);
  const [holdMs, setHoldMs] = useState(120);
  const [zoomOutMs, setZoomOutMs] = useState(260);
  const [regionEnabled, setRegionEnabled] = useState(false);
  const [region, setRegion] = useState<CaptureRegion>({
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

  const frameRateText = useMemo(
    () => `${status.targetFps}fps target`,
    [status.targetFps],
  );

  const selectedDisplayLabel = useMemo(() => {
    if (displaySelection === "auto") {
      return "Auto display selection";
    }

    const selected = displays.find((display) => String(display.index) === displaySelection);
    if (!selected) {
      return "Custom display selection";
    }

    return `${selected.isPrimary ? "Primary" : `Display ${selected.index + 1}`} ${selected.width}x${selected.height}`;
  }, [displaySelection, displays]);

  const sessionDurationMs = lastSession?.durationMs ?? 0;

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
    if (launcherMode === "area") {
      setRegionEnabled(true);
      return;
    }

    setRegionEnabled(false);
  }, [launcherMode]);

  async function loadDisplays() {
    try {
      const availableDisplays = await invoke<DisplayDescriptor[]>("list_displays");
      setDisplays(availableDisplays);
    } catch {
      setDisplays([]);
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

  async function startRecording() {
    try {
      const request = {
        fps,
        region: regionEnabled ? region : null,
        displayIndex: displaySelection === "auto" ? null : Number(displaySelection),
      };
      const nextStatus = await invoke<RecordingStatus>("start_recording", {
        request,
      });
      setStatus(nextStatus);
      setRecording(true);
      setLastSession(null);
      setTimeline([]);
      setPreviewUrl(null);
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
      const clicks = await invoke<ClickEvent[]>("get_click_timeline");
      setTimeline(clicks.slice(-16).reverse());
      const nextStatus = await invoke<RecordingStatus>("get_recording_status");
      setStatus(nextStatus);
      await openEditorWindow();
      if (windowLabel === "editor") {
        setView("editor");
      }
      setMessage("Recording complete. Editor window opened for trim and styling.");
    } catch (error) {
      setMessage(`Could not stop recording: ${String(error)}`);
    }
  }

  async function refreshEditorSessionData() {
    try {
      const [nextStatus, clicks, summary] = await Promise.all([
        invoke<RecordingStatus>("get_recording_status"),
        invoke<ClickEvent[]>("get_click_timeline"),
        invoke<StopRecordingResponse | null>("get_last_session_summary"),
      ]);

      setStatus(nextStatus);
      setRecording(nextStatus.isRecording);
      setTimeline(clicks.slice(-16).reverse());

      if (summary) {
        setLastSession(summary);
        setTrimStartMs((prev) => Math.min(prev, summary.durationMs));
        setTrimEndMs((prev) => {
          if (prev <= 0) {
            return summary.durationMs;
          }

          return Math.min(prev, summary.durationMs);
        });
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
      const exportResult = await invoke<ExportRecordingResponse>("export_recording", {
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
      setMessage(
        `GPU renderer ready on ${next.backend ?? "unknown"} (${next.adapterName ?? "adapter"}).`,
      );
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
    setMessage("Back to launcher. Configure and start a new recording.");
  }

  if (view === "launcher") {
    return (
      <main className="app-root">
        <section className="launcher-bar">
          <button type="button" className="icon-circle" aria-label="Close launcher">
            x
          </button>

          <div className="mode-group">
            <button
              type="button"
              className={launcherMode === "display" ? "mode-chip active" : "mode-chip"}
              onClick={() => selectLauncherMode("display")}
            >
              Display
            </button>
            <button
              type="button"
              className={launcherMode === "window" ? "mode-chip active" : "mode-chip"}
              onClick={() => selectLauncherMode("window")}
            >
              Window
            </button>
            <button
              type="button"
              className={launcherMode === "area" ? "mode-chip active" : "mode-chip"}
              onClick={() => selectLauncherMode("area")}
            >
              Area
            </button>
            <button
              type="button"
              className={launcherMode === "device" ? "mode-chip active" : "mode-chip"}
              onClick={() => selectLauncherMode("device")}
            >
              Device
            </button>
          </div>

          <div className="toggle-group">
            <button
              type="button"
              className={cameraEnabled ? "toggle-pill enabled" : "toggle-pill"}
              onClick={() => setCameraEnabled((prev) => !prev)}
            >
              {cameraEnabled ? "Camera on" : "No camera"}
            </button>
            <button
              type="button"
              className={micEnabled ? "toggle-pill enabled" : "toggle-pill"}
              onClick={() => setMicEnabled((prev) => !prev)}
            >
              {micEnabled ? "Microphone on" : "No microphone"}
            </button>
            <button
              type="button"
              className={appAudioEnabled ? "toggle-pill enabled" : "toggle-pill"}
              onClick={() => setAppAudioEnabled((prev) => !prev)}
            >
              {appAudioEnabled ? "Sound from 1 app" : "Sound off"}
            </button>
          </div>
        </section>

        <section className="launcher-panel">
          <div className="panel-row">
            <label>
              Display
              <select
                value={displaySelection}
                onChange={(event) => setDisplaySelection(event.currentTarget.value)}
                disabled={recording}
              >
                <option value="auto">Auto (cursor monitor at start)</option>
                {displays.map((display) => (
                  <option key={display.id} value={display.index}>
                    {display.isPrimary ? "Primary" : `Display ${display.index + 1}`} - {display.width}x{display.height}
                  </option>
                ))}
              </select>
            </label>

            <label>
              FPS
              <input
                type="number"
                value={fps}
                min={24}
                max={60}
                onChange={(event) => setFps(Number(event.currentTarget.value))}
                disabled={recording}
              />
            </label>

            <label>
              Status
              <input type="text" value={recording ? "Recording" : "Ready"} disabled />
            </label>
          </div>

          {regionEnabled && (
            <div className="panel-row">
              <label>
                X
                <input
                  type="number"
                  value={region.x}
                  onChange={(event) =>
                    setRegion((prev) => ({ ...prev, x: Number(event.currentTarget.value) }))
                  }
                  disabled={recording}
                />
              </label>
              <label>
                Y
                <input
                  type="number"
                  value={region.y}
                  onChange={(event) =>
                    setRegion((prev) => ({ ...prev, y: Number(event.currentTarget.value) }))
                  }
                  disabled={recording}
                />
              </label>
              <label>
                Width
                <input
                  type="number"
                  value={region.width}
                  onChange={(event) =>
                    setRegion((prev) => ({ ...prev, width: Number(event.currentTarget.value) }))
                  }
                  disabled={recording}
                />
              </label>
              <label>
                Height
                <input
                  type="number"
                  value={region.height}
                  onChange={(event) =>
                    setRegion((prev) => ({ ...prev, height: Number(event.currentTarget.value) }))
                  }
                  disabled={recording}
                />
              </label>
            </div>
          )}

          <div className="launcher-actions">
            <button type="button" onClick={startRecording} disabled={recording}>
              Start Recording
            </button>
            <button type="button" onClick={stopRecording} disabled={!recording}>
              Stop Recording
            </button>
            <button type="button" onClick={loadDisplays} disabled={recording}>
              Refresh Displays
            </button>
            <button
              type="button"
              onClick={() => void openEditorWindow()}
              disabled={recording || (!lastSession && status.framesCaptured === 0)}
            >
              Open Editor
            </button>
          </div>

          <div className="session-strip">
            <span>{selectedDisplayLabel}</span>
            <span>{frameRateText}</span>
            <span>{status.framesCaptured.toLocaleString()} frames</span>
            <span>{status.clicksDetected.toLocaleString()} clicks</span>
          </div>
        </section>

        <p className="message-text">{message}</p>
      </main>
    );
  }

  return (
    <main className="editor-root">
      <header className="editor-topbar">
        <div className="editor-title">
          <p className="eyebrow">SmoothShot Editor</p>
          <h1>Recording Session</h1>
        </div>
        <div className="editor-actions">
          <button type="button" onClick={() => void startNewRecordingFlow()}>Launcher</button>
          <button type="button" onClick={initializeGpuRenderer}>Init GPU</button>
          <button type="button" onClick={generateZoomPreview}>Analyze Zoom</button>
          <button
            type="button"
            className="primary"
            onClick={exportRecording}
            disabled={recording || isExporting}
          >
            {isExporting ? "Exporting..." : "Export 1080p60"}
          </button>
        </div>
      </header>

      <section className="editor-grid">
        <article className="editor-canvas">
          <h2>Preview</h2>
          {!previewUrl && (
            <p className="placeholder">
              Export once to load preview. Timeline and style controls are now prepared for the editor phase.
            </p>
          )}
          {previewUrl && (
            <video className="preview-player" src={previewUrl} controls preload="metadata" />
          )}

          <div className="transport-row">
            <span>Duration: {(sessionDurationMs / 1000).toFixed(2)}s</span>
            <span>Frames: {status.framesCaptured.toLocaleString()}</span>
            <span>Clicks: {status.clicksDetected.toLocaleString()}</span>
            {gpuStatus && <span>GPU: {gpuStatus.backend ?? "unknown"}</span>}
          </div>
        </article>

        <aside className="editor-inspector">
          <section className="inspector-block">
            <h3>Trim</h3>
            <label>
              Start (ms)
              <input
                type="number"
                min={0}
                max={Math.max(trimEndMs, 0)}
                value={trimStartMs}
                onChange={(event) => setTrimStartMs(Number(event.currentTarget.value))}
              />
            </label>
            <label>
              End (ms)
              <input
                type="number"
                min={trimStartMs}
                max={Math.max(sessionDurationMs, trimStartMs)}
                value={trimEndMs}
                onChange={(event) => setTrimEndMs(Number(event.currentTarget.value))}
              />
            </label>
          </section>

          <section className="inspector-block">
            <h3>Frame Style</h3>
            <label>
              Padding
              <input
                type="range"
                min={0}
                max={120}
                value={padding}
                onChange={(event) => setPadding(Number(event.currentTarget.value))}
              />
            </label>
            <label>
              Scale %
              <input
                type="range"
                min={70}
                max={110}
                value={scalePercent}
                onChange={(event) => setScalePercent(Number(event.currentTarget.value))}
              />
            </label>
          </section>

          <section className="inspector-block">
            <h3>Zoom</h3>
            <label>
              Max Zoom
              <input
                type="number"
                step="0.05"
                min={1.05}
                max={3}
                value={maxZoom}
                onChange={(event) => setMaxZoom(Number(event.currentTarget.value))}
              />
            </label>
            <label>
              In / Hold / Out
              <div className="compact-grid">
                <input
                  type="number"
                  min={60}
                  value={zoomInMs}
                  onChange={(event) => setZoomInMs(Number(event.currentTarget.value))}
                />
                <input
                  type="number"
                  min={0}
                  value={holdMs}
                  onChange={(event) => setHoldMs(Number(event.currentTarget.value))}
                />
                <input
                  type="number"
                  min={80}
                  value={zoomOutMs}
                  onChange={(event) => setZoomOutMs(Number(event.currentTarget.value))}
                />
              </div>
            </label>
          </section>

          <section className="inspector-block">
            <h3>Audio</h3>
            <label>
              Gain %
              <input
                type="range"
                min={0}
                max={150}
                value={audioGain}
                onChange={(event) => setAudioGain(Number(event.currentTarget.value))}
              />
            </label>
          </section>

          <section className="inspector-block">
            <h3>Export</h3>
            <label>
              Output Path (optional)
              <input
                type="text"
                value={exportPath}
                onChange={(event) => setExportPath(event.currentTarget.value)}
                placeholder="D:/Videos/smoothshot.mp4"
                disabled={isExporting}
              />
            </label>
            <div className="editor-actions">
              <button type="button" onClick={openExportedFile} disabled={!lastExport}>
                Open File
              </button>
            </div>
          </section>
        </aside>
      </section>

      <section className="timeline-shell">
        <h2>Timeline</h2>
        <div className="timeline-track">
          {timeline.length === 0 && <span className="placeholder">No click markers yet.</span>}
          {timeline.map((event, index) => (
            <span key={`${event.timestampMs}-${index}`} className="timeline-marker">
              {Math.round(event.timestampMs / 1000)}s
            </span>
          ))}
        </div>
        <div className="timeline-meta">
          <span>Trim: {trimStartMs}ms to {trimEndMs}ms</span>
          <span>Padding: {padding}</span>
          <span>Scale: {scalePercent}%</span>
          <span>Audio: {audioGain}%</span>
          {zoomPreview && <span>Zoom events: {zoomPreview.clickCount}</span>}
        </div>
      </section>

      {lastExport && (
        <section className="export-result">
          <p>Exported: {lastExport.outputPath}</p>
          <p>
            {lastExport.width}x{lastExport.height} at {lastExport.targetFps}fps |
            {" "}{(lastExport.outputDurationMs / 1000).toFixed(2)}s
          </p>
        </section>
      )}

      <p className="message-text">{message}</p>
    </main>
  );
}

export default App;
