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
      const exportResult = await invoke<ExportRecordingResponse>("export_recording", {
        request: {
          maxZoom: 1.85,
          zoomInMs: 180,
          holdMs: 120,
          zoomOutMs: 260,
        },
      });
      setLastExport(exportResult);
      setPreviewUrl(toLocalFileUrl(exportResult.outputPath));
      setMessage(`Export completed: ${exportResult.outputPath}`);
    } catch (error) {
      setMessage(String(error));
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
          zoomInMs: 180,
          holdMs: 120,
          zoomOutMs: 260,
          maxZoom: 1.85,
        },
      });
      setZoomPreview(preview);
      setMessage(`Zoom preview generated from ${preview.clickCount} click events.`);
    } catch (error) {
      setMessage(`Could not build zoom preview: ${String(error)}`);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">SmoothShot Studio</p>
        <h1>Screen Recording Workspace</h1>
        <p className="status-line">{message}</p>
      </section>

      <section className="control-card">
        <div className="control-grid">
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
                  {display.isPrimary ? "Primary" : `Display ${display.index + 1}`} - {display.width}x{display.height} @ ({display.x},{display.y})
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
            Start Recording
          </button>
          <button type="button" onClick={stopRecording} disabled={!recording}>
            Stop Recording
          </button>
          <button type="button" onClick={loadDisplays} disabled={recording}>
            Refresh Displays
          </button>
          <button type="button" onClick={exportRecording} disabled={recording}>
            Export
          </button>
          <button type="button" onClick={initializeGpuRenderer}>
            Init GPU
          </button>
          <button type="button" onClick={generateZoomPreview} disabled={recording}>
            Build Zoom Preview
          </button>
        </div>
      </section>

      <section className="stats-card">
        <h2>Live Capture State</h2>
        <div className="stat-grid">
          <article>
            <span>Mode</span>
            <strong>{status.isRecording ? "Recording" : "Idle"}</strong>
          </article>
          <article>
            <span>Frame Budget</span>
            <strong>{frameRateText}</strong>
          </article>
          <article>
            <span>Frames</span>
            <strong>{status.framesCaptured.toLocaleString()}</strong>
          </article>
          <article>
            <span>Clicks</span>
            <strong>{status.clicksDetected.toLocaleString()}</strong>
          </article>
        </div>
      </section>

      <section className="timeline-card">
        <h2>Recent Click Timeline</h2>
        <ul>
          {timeline.length === 0 && <li>No clicks captured yet.</li>}
          {timeline.map((event, index) => (
            <li key={`${event.timestampMs}-${index}`}>
              t={event.timestampMs}ms | {event.button} | ({event.cursorX}, {event.cursorY})
            </li>
          ))}
        </ul>
        {lastSession && (
          <p className="session-summary">
            Last session: {lastSession.framesCaptured} frames in {lastSession.durationMs}ms, {" "}
            {lastSession.clicksDetected} clicks.
          </p>
        )}
      </section>

      <section className="timeline-card">
        <h2>Auto Zoom Preview (v0.2)</h2>
        {!gpuStatus && <p>GPU renderer not initialized yet.</p>}
        {gpuStatus && (
          <p>
            GPU: {gpuStatus.adapterName ?? "Unknown adapter"} ({gpuStatus.backend ?? "unknown"})
          </p>
        )}
        {!zoomPreview && <p>No preview generated yet.</p>}
        {zoomPreview && (
          <>
            <p>
              Profile: {zoomPreview.profile.easing}, in {zoomPreview.profile.zoomInMs}ms, hold {" "}
              {zoomPreview.profile.holdMs}ms, out {zoomPreview.profile.zoomOutMs}ms, max {" "}
              {zoomPreview.profile.maxZoom.toFixed(2)}x
            </p>
            <ul>
              {zoomPreview.frames.slice(0, 8).map((frame) => (
                <li key={frame.frameIndex}>
                  frame {frame.frameIndex} | t={frame.timestampMs}ms | zoom {frame.zoom.toFixed(2)}x | focus ({frame.focusX}, {frame.focusY})
                  {frame.clickDriven ? " | click" : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="timeline-card">
        <h2>Export Output (v0.3)</h2>
        {!lastExport && <p>No export created yet.</p>}
        {lastExport && (
          <>
            <ul>
              <li>Path: <span className="path-chip">{lastExport.outputPath}</span></li>
              <li>Frames: {lastExport.framesExported.toLocaleString()}</li>
              <li>Video: {lastExport.width}x{lastExport.height}</li>
              <li>FPS target: {lastExport.targetFps}</li>
              <li>Duration: {(lastExport.outputDurationMs / 1000).toFixed(2)}s</li>
            </ul>
            <div className="button-row">
              <button type="button" onClick={openExportedFile}>Open Exported File</button>
            </div>
          </>
        )}
      </section>

      <section className="timeline-card">
        <h2>Basic Preview (v0.4)</h2>
        {!previewUrl && <p>No preview available yet. Export once to preview.</p>}
        {previewUrl && <video className="preview-player" src={previewUrl} controls preload="metadata" />}
      </section>
    </main>
  );
}

export default App;
