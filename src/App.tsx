import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

function App() {
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

  async function loadDisplays() {
    try {
      const availableDisplays = await invoke<DisplayDescriptor[]>("list_displays");
      setDisplays(availableDisplays);
    } catch {
      setDisplays([]);
    }
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
      setMessage("Recording started. Move and click naturally for zoom metadata.");
    } catch (error) {
      setMessage(`Could not start recording: ${String(error)}`);
    }
  }

  async function stopRecording() {
    try {
      const result = await invoke<StopRecordingResponse>("stop_recording");
      setLastSession(result);
      setRecording(false);
      setMessage("Capture complete. Export pipeline arrives in v0.3.0.");
      const clicks = await invoke<ClickEvent[]>("get_click_timeline");
      setTimeline(clicks.slice(-8).reverse());
      const nextStatus = await invoke<RecordingStatus>("get_recording_status");
      setStatus(nextStatus);
    } catch (error) {
      setMessage(`Could not stop recording: ${String(error)}`);
    }
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
      const status = await invoke<GpuInitStatus>("initialize_gpu_renderer");
      setGpuStatus(status);
      setMessage(
        `GPU renderer ready on ${status.backend ?? "unknown"} (${status.adapterName ?? "adapter"}).`,
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

  return (
    <main className="studio-root">
      <header className="studio-header">
        <div>
          <p className="eyebrow">SmoothShot</p>
          <h1>Studio Recorder</h1>
        </div>
        <div className="status-badges">
          <span className={`badge ${recording ? "badge-live" : "badge-idle"}`}>
            {recording ? "Recording" : "Idle"}
          </span>
          <span className="badge badge-muted">{selectedDisplayLabel}</span>
          <span className="badge badge-muted">{frameRateText}</span>
        </div>
      </header>

      <p className="message-bar">{message}</p>

      <section className="workspace-grid">
        <aside className="panel stack-gap">
          <div className="panel-block">
            <h2>Capture</h2>
            <div className="field-grid">
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
                Target FPS
                <input
                  type="number"
                  value={fps}
                  min={24}
                  max={60}
                  onChange={(event) => setFps(Number(event.currentTarget.value))}
                  disabled={recording}
                />
              </label>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={regionEnabled}
                  onChange={(event) => setRegionEnabled(event.currentTarget.checked)}
                  disabled={recording}
                />
                Region mode
              </label>

              <label>
                X
                <input
                  type="number"
                  value={region.x}
                  onChange={(event) =>
                    setRegion((prev) => ({ ...prev, x: Number(event.currentTarget.value) }))
                  }
                  disabled={!regionEnabled || recording}
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
                  disabled={!regionEnabled || recording}
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
                  disabled={!regionEnabled || recording}
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
                  disabled={!regionEnabled || recording}
                />
              </label>
            </div>

            <div className="button-row">
              <button type="button" onClick={startRecording} disabled={recording}>
                Start
              </button>
              <button type="button" onClick={stopRecording} disabled={!recording}>
                Stop
              </button>
              <button type="button" onClick={loadDisplays} disabled={recording}>
                Refresh Displays
              </button>
            </div>
          </div>

          <div className="panel-block">
            <h2>Export</h2>
            <div className="field-grid">
              <label className="field-span">
                Output file (optional)
                <input
                  type="text"
                  value={exportPath}
                  onChange={(event) => setExportPath(event.currentTarget.value)}
                  placeholder="Example: D:/Videos/smoothshot.mp4"
                  disabled={recording || isExporting}
                />
              </label>

              <label>
                Max Zoom
                <input
                  type="number"
                  step="0.05"
                  min="1.05"
                  max="3"
                  value={maxZoom}
                  onChange={(event) => setMaxZoom(Number(event.currentTarget.value))}
                  disabled={recording || isExporting}
                />
              </label>

              <label>
                Zoom In (ms)
                <input
                  type="number"
                  min="60"
                  value={zoomInMs}
                  onChange={(event) => setZoomInMs(Number(event.currentTarget.value))}
                  disabled={recording || isExporting}
                />
              </label>

              <label>
                Hold (ms)
                <input
                  type="number"
                  min="0"
                  value={holdMs}
                  onChange={(event) => setHoldMs(Number(event.currentTarget.value))}
                  disabled={recording || isExporting}
                />
              </label>

              <label>
                Zoom Out (ms)
                <input
                  type="number"
                  min="80"
                  value={zoomOutMs}
                  onChange={(event) => setZoomOutMs(Number(event.currentTarget.value))}
                  disabled={recording || isExporting}
                />
              </label>
            </div>

            <div className="button-row">
              <button type="button" onClick={exportRecording} disabled={recording || isExporting}>
                {isExporting ? "Exporting..." : "Export MP4"}
              </button>
              <button type="button" onClick={openExportedFile} disabled={!lastExport}>
                Open File
              </button>
            </div>
          </div>

          <div className="panel-block">
            <h2>Engine</h2>
            <div className="button-row">
              <button type="button" onClick={initializeGpuRenderer}>Init GPU</button>
              <button type="button" onClick={generateZoomPreview} disabled={recording}>
                Build Zoom Preview
              </button>
            </div>
            {gpuStatus && (
              <p className="micro-text">
                GPU: {gpuStatus.adapterName ?? "Unknown adapter"} ({gpuStatus.backend ?? "unknown"})
              </p>
            )}
          </div>
        </aside>

        <section className="panel stack-gap">
          <div className="panel-block">
            <h2>Preview</h2>
            {!previewUrl && <p className="placeholder">Export once to load preview.</p>}
            {previewUrl && (
              <video className="preview-player" src={previewUrl} controls preload="metadata" />
            )}
          </div>

          <div className="panel-block">
            <h2>Session Metrics</h2>
            <div className="stat-grid">
              <article>
                <span>Frames</span>
                <strong>{status.framesCaptured.toLocaleString()}</strong>
              </article>
              <article>
                <span>Clicks</span>
                <strong>{status.clicksDetected.toLocaleString()}</strong>
              </article>
              <article>
                <span>Last Duration</span>
                <strong>{lastSession ? `${(lastSession.durationMs / 1000).toFixed(2)}s` : "-"}</strong>
              </article>
              <article>
                <span>Export Duration</span>
                <strong>{lastExport ? `${(lastExport.outputDurationMs / 1000).toFixed(2)}s` : "-"}</strong>
              </article>
            </div>
          </div>

          <div className="panel-block">
            <h2>Export Details</h2>
            {!lastExport && <p className="placeholder">No export yet.</p>}
            {lastExport && (
              <ul className="detail-list">
                <li>Path: <span className="path-chip">{lastExport.outputPath}</span></li>
                <li>Frames: {lastExport.framesExported.toLocaleString()}</li>
                <li>Video: {lastExport.width}x{lastExport.height}</li>
                <li>FPS target: {lastExport.targetFps}</li>
              </ul>
            )}
          </div>

          <div className="panel-block">
            <h2>Click Timeline</h2>
            {timeline.length === 0 && <p className="placeholder">No clicks captured yet.</p>}
            {timeline.length > 0 && (
              <ul className="detail-list">
                {timeline.map((event, index) => (
                  <li key={`${event.timestampMs}-${index}`}>
                    t={event.timestampMs}ms | {event.button} | ({event.cursorX}, {event.cursorY})
                  </li>
                ))}
              </ul>
            )}
            {zoomPreview && (
              <p className="micro-text">
                Zoom profile: {zoomPreview.profile.maxZoom.toFixed(2)}x max, {zoomPreview.profile.easing}
              </p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;
