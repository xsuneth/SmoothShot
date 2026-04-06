import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { CameraPreviewWindow } from "../components/CameraPreviewWindow";
import { useCameraPreview } from "../hooks/useCameraPreview";
import { EVT_CAMERA_PREVIEW_DATA } from "../lib/constants";

type CameraPreviewEvent = {
  selectedCameraDevice: string | null;
};

function getInitialCameraFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const camera = params.get("camera");
  return camera && camera.trim().length > 0 ? camera : null;
}

export function CameraPreviewApp() {
  const [selectedCameraDevice, setSelectedCameraDevice] = useState<string | null>(
    getInitialCameraFromUrl,
  );

  // Listen for camera device updates from the launcher
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    try {
      const webview = getCurrentWebviewWindow();
      void webview
        .listen<CameraPreviewEvent>(EVT_CAMERA_PREVIEW_DATA, (event) => {
          setSelectedCameraDevice(event.payload.selectedCameraDevice);
        })
        .then((dispose) => {
          unlisten = dispose;
        })
        .catch(() => {});
    } catch {
      // ignore
    }

    return () => {
      unlisten?.();
    };
  }, []);

  // Hardware-accelerated camera preview via getUserMedia — no Rust IPC needed
  const preview = useCameraPreview({ cameraName: selectedCameraDevice });

  return (
    <CameraPreviewWindow
      videoRef={preview.videoRef}
      error={preview.error}
      hasCamera={Boolean(selectedCameraDevice)}
      isStreaming={preview.isStreaming}
    />
  );
}
