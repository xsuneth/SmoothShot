import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

  async function startRecording() {
    try {
      const request = {
        fps,
        region: regionEnabled ? region : null,
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
      await invoke("export_recording");
    } catch (error) {
      setMessage(String(error));
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">SmoothShot v0.1.0 foundation</p>
        <h1>Cinematic Screen Capture Controls</h1>
        <p className="status-line">{message}</p>
      </section>

      <section className="control-card">
        <div className="control-grid">
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
          <button type="button" onClick={exportRecording} disabled={recording}>
            Export
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
    </main>
  );
}

export default App;
