import { useCallback } from "react";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors, currentMonitor, primaryMonitor } from "@tauri-apps/api/window";

import { EVT_CAMERA_PREVIEW_DATA, WINDOW_LABEL_CAMERA_PREVIEW } from "../lib/constants";

interface UseCameraPreviewWindowParams {
  selectedCameraDevice: string | null;
}

export interface UseCameraPreviewWindowResult {
  showCameraPreviewWindow: () => Promise<void>;
  hideCameraPreviewWindow: () => Promise<void>;
  syncCameraPreviewWindow: (enabled: boolean) => Promise<void>;
  snapCameraPreviewToDefaultPosition: () => Promise<void>;
}

// Startup/default preview placement. Keep square to match the camera preview window layout.
const PREVIEW_SIZE = 250;
const PREVIEW_MARGIN_X = 60;
const PREVIEW_MARGIN_Y = 70;

export function useCameraPreviewWindow({ selectedCameraDevice }: UseCameraPreviewWindowParams): UseCameraPreviewWindowResult {
  const resolveMonitor = useCallback(async () => {
    const active = await currentMonitor();
    if (active) return active;

    const primary = await primaryMonitor();
    if (primary) return primary;

    const all = await availableMonitors();
    return all[0] ?? null;
  }, []);

  const positionWindow = useCallback(async (popup: WebviewWindow) => {
    const monitor = await resolveMonitor();
    if (!monitor) return;

    const scale = monitor.scaleFactor || 1;
    const monitorX = monitor.position.x / scale;
    const monitorY = monitor.position.y / scale;
    const monitorWidth = monitor.size.width / scale;
    const monitorHeight = monitor.size.height / scale;

    const x = Math.round(monitorX + monitorWidth - PREVIEW_SIZE - PREVIEW_MARGIN_X);
    const y = Math.round(monitorY + monitorHeight - PREVIEW_SIZE - PREVIEW_MARGIN_Y);
    await popup.setSize(new LogicalSize(PREVIEW_SIZE, PREVIEW_SIZE));
    await popup.setPosition(new LogicalPosition(x, y));
  }, [resolveMonitor]);

  const emitCurrentCamera = useCallback(async (popup: WebviewWindow) => {
    await popup.emit(EVT_CAMERA_PREVIEW_DATA, { selectedCameraDevice }).catch(() => {});
  }, [selectedCameraDevice]);

  const ensureWindow = useCallback(async () => {
    let popup = await WebviewWindow.getByLabel(WINDOW_LABEL_CAMERA_PREVIEW);

    if (!popup) {
      const cameraParam = selectedCameraDevice ? `&camera=${encodeURIComponent(selectedCameraDevice)}` : "";
      const created = new WebviewWindow(WINDOW_LABEL_CAMERA_PREVIEW, {
        url: `/?window=${WINDOW_LABEL_CAMERA_PREVIEW}${cameraParam}`,
        title: "Camera Preview",
        width: PREVIEW_SIZE,
        height: PREVIEW_SIZE,
        minWidth: PREVIEW_SIZE,
        minHeight: PREVIEW_SIZE,
        maxWidth: PREVIEW_SIZE,
        maxHeight: PREVIEW_SIZE,
        decorations: false,
        transparent: false,
        shadow: true,
        alwaysOnTop: true,
        focus: false,
        visible: false,
        skipTaskbar: true,
        resizable: false,
      });

      await new Promise<void>((resolve, reject) => {
        void created.once("tauri://created", () => resolve());
        void created.once("tauri://error", (e: unknown) => reject(new Error(String(e))));
      });

      popup = await WebviewWindow.getByLabel(WINDOW_LABEL_CAMERA_PREVIEW);
    }

    if (!popup) throw new Error("camera preview window was not created");
    return popup;
  }, []);

  const showCameraPreviewWindow = useCallback(async () => {
    if (!selectedCameraDevice) return;

    // No Rust stream lifecycle needed — the preview window uses getUserMedia
    // directly in the browser for hardware-accelerated rendering.
    const popup = await ensureWindow();
    await positionWindow(popup);
    await popup.show();
    await positionWindow(popup);
    window.setTimeout(() => {
      void positionWindow(popup);
    }, 120);

    // Emit camera device info so the preview window knows which camera to use
    await new Promise((r) => window.setTimeout(r, 200));
    await emitCurrentCamera(popup);

    // Retry emits to handle race between window creation and listener mount
    for (let i = 0; i < 4; i += 1) {
      window.setTimeout(() => { void emitCurrentCamera(popup); }, 200 + 150 * (i + 1));
    }
  }, [emitCurrentCamera, ensureWindow, positionWindow, selectedCameraDevice]);

  const hideCameraPreviewWindow = useCallback(async () => {
    const popup = await WebviewWindow.getByLabel(WINDOW_LABEL_CAMERA_PREVIEW);
    if (popup) {
      await popup.hide().catch(() => {});
    }
  }, []);

  const syncCameraPreviewWindow = useCallback(async (enabled: boolean) => {
    if (enabled) {
      await showCameraPreviewWindow();
    } else {
      await hideCameraPreviewWindow();
    }
  }, [hideCameraPreviewWindow, showCameraPreviewWindow]);

  const snapCameraPreviewToDefaultPosition = useCallback(async () => {
    const popup = await WebviewWindow.getByLabel(WINDOW_LABEL_CAMERA_PREVIEW);
    if (!popup) {
      return;
    }
    // Hide first to clear any remembered position, then reposition.
    await popup.hide().catch(() => {});
    await positionWindow(popup);
  }, [positionWindow]);

  return { showCameraPreviewWindow, hideCameraPreviewWindow, syncCameraPreviewWindow, snapCameraPreviewToDefaultPosition };
}
