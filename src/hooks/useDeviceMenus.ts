import { useCallback } from "react";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { InputDeviceOption } from "../types";

/**
 * Builds and shows native camera/microphone selection popup menus.
 */
export interface UseDeviceMenusResult {
  showCameraMenu: (anchorX: number, anchorY: number) => Promise<void>;
  showMicMenu: (anchorX: number, anchorY: number) => Promise<void>;
}

interface UseDeviceMenusParams {
  cameraDevices: InputDeviceOption[];
  microphoneDevices: InputDeviceOption[];
  selectedCameraDevice: string | null;
  selectedMicrophoneDevice: string | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
  setSelectedCameraDevice: (id: string | null) => void;
  setSelectedMicrophoneDevice: (id: string | null) => void;
  setCameraEnabled: (enabled: boolean) => void;
  setMessage: (message: string) => void;
  toggleMic: () => Promise<void>;
}

export function useDeviceMenus({
  cameraDevices,
  microphoneDevices,
  selectedCameraDevice,
  selectedMicrophoneDevice,
  cameraEnabled,
  micEnabled,
  setSelectedCameraDevice,
  setSelectedMicrophoneDevice,
  setCameraEnabled,
  setMessage,
  toggleMic,
}: UseDeviceMenusParams): UseDeviceMenusResult {
  const showCameraMenu = useCallback(async (anchorX: number, anchorY: number) => {
    try {
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
              const next = !cameraEnabled;
              if (next && !selectedCameraDevice && cameraDevices.length > 0) {
                // Auto-select first device when enabling camera if none selected.
                setSelectedCameraDevice(cameraDevices[0].id);
              }
              setCameraEnabled(next);
              setMessage(next ? `Camera enabled${selectedCameraDevice || cameraDevices[0] ? `: ${selectedCameraDevice || cameraDevices[0]?.name}` : ""}` : "Camera disabled");
            },
          },
        ],
      });

      await menu.popup(new LogicalPosition(anchorX - 36, anchorY - 60), getCurrentWindow());
    } catch {
      // Ignore menu popup failures.
    }
  }, [cameraDevices, cameraEnabled, selectedCameraDevice, setCameraEnabled, setMessage, setSelectedCameraDevice]);

  const showMicMenu = useCallback(async (anchorX: number, anchorY: number) => {
    try {
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
    } catch {
      // Ignore menu popup failures.
    }
  }, [microphoneDevices, micEnabled, selectedMicrophoneDevice, setMessage, setSelectedMicrophoneDevice, toggleMic]);

  return {
    showCameraMenu,
    showMicMenu,
  };
}
