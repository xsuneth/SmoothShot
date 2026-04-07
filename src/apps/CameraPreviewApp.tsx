import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { CameraPreviewWindow } from "../components/CameraPreviewWindow";
import { useCameraPreview } from "../hooks/useCameraPreview";
import {
  EVT_CAMERA_PREVIEW_DATA,
  EVT_CAMERA_RECORD_START,
  EVT_CAMERA_RECORD_STOP,
} from "../lib/constants";

type CameraPreviewEvent = {
  selectedCameraDevice: string | null;
};

type CameraRecordStartEvent = {
  sessionFolder: string;
};

type CameraRecordStopEvent = {
  save: boolean;
};

function getInitialCameraFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const camera = params.get("camera");
  return camera && camera.trim().length > 0 ? camera : null;
}

/** Pick the best supported webm mimeType for MediaRecorder. */
function bestMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}

export function CameraPreviewApp() {
  const [selectedCameraDevice, setSelectedCameraDevice] = useState<string | null>(
    getInitialCameraFromUrl,
  );

  const preview = useCameraPreview({ cameraName: selectedCameraDevice });

  // MediaRecorder state — kept in refs to avoid stale closures in event listeners
  const recorderRef = useRef<MediaRecorder | null>(null);
  const outputPathRef = useRef<string | null>(null);

  // Listen for camera device updates from the launcher
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      void getCurrentWebviewWindow()
        .listen<CameraPreviewEvent>(EVT_CAMERA_PREVIEW_DATA, (event) => {
          setSelectedCameraDevice(event.payload.selectedCameraDevice);
        })
        .then((dispose) => { unlisten = dispose; })
        .catch(() => {});
    } catch { /* ignore */ }
    return () => { unlisten?.(); };
  }, []);

  // Listen for recording start — begin MediaRecorder on the existing getUserMedia stream
  useEffect(() => {
    const unlisten = listen<CameraRecordStartEvent>(EVT_CAMERA_RECORD_START, (event) => {
      const stream = preview.streamRef.current;
      if (!stream) return;

      // Clean up any previous recorder
      if (recorderRef.current) {
        recorderRef.current.stop();
        recorderRef.current = null;
      }

      const outputPath = `${event.payload.sessionFolder}/camera.webm`;
      outputPathRef.current = outputPath;

      const mimeType = bestMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        void e.data.arrayBuffer().then((buf) => {
          const chunk = Array.from(new Uint8Array(buf));
          void invoke("append_camera_chunk", { path: outputPath, chunk });
        });
      };

      recorder.start(500); // flush a chunk every 500 ms
      recorderRef.current = recorder;
    });

    return () => { void unlisten.then((fn) => fn()); };
  }, [preview.streamRef]);

  // Listen for recording stop — finalize the file
  useEffect(() => {
    const unlisten = listen<CameraRecordStopEvent>(EVT_CAMERA_RECORD_STOP, (event) => {
      const recorder = recorderRef.current;
      if (!recorder) return;

      const outputPath = outputPathRef.current;
      const shouldSave = event.payload.save;

      recorder.onstop = () => {
        if (shouldSave && outputPath) {
          // Small delay to let the last append_camera_chunk IPC call finish
          window.setTimeout(() => {
            void invoke("set_camera_video_path", { path: outputPath });
          }, 300);
        } else if (!shouldSave && outputPath) {
          // Delete discarded recording
          void invoke("append_camera_chunk", { path: outputPath, chunk: [] }).catch(() => {});
        }
        recorderRef.current = null;
        outputPathRef.current = null;
      };

      recorder.stop();
    });

    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  return (
    <CameraPreviewWindow
      videoRef={preview.videoRef}
      error={preview.error}
      hasCamera={Boolean(selectedCameraDevice)}
      isStreaming={preview.isStreaming}
    />
  );
}
