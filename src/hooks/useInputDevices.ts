import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { InputDeviceOption } from "../types";
import { useAppStore } from "../store/useAppStore";

export interface UseInputDevicesResult {
  cameraDevices: InputDeviceOption[];
  microphoneDevices: InputDeviceOption[];
  selectedCameraDevice: string | null;
  selectedMicrophoneDevice: string | null;
  setSelectedCameraDevice: (id: string | null) => void;
  setSelectedMicrophoneDevice: (id: string | null) => void;
  loadInputDevices: () => Promise<void>;
}

export function useInputDevices(): UseInputDevicesResult {
  const [cameraDevices, setCameraDevices] = useState<InputDeviceOption[]>([]);
  const [microphoneDevices, setMicrophoneDevices] = useState<InputDeviceOption[]>([]);

  const selectedCameraDevice = useAppStore((s) => s.selectedCameraDevice);
  const setSelectedCameraDevice = useAppStore((s) => s.setSelectedCameraDevice);
  const selectedMicrophoneDevice = useAppStore((s) => s.selectedMicrophoneDevice);
  const setSelectedMicrophoneDevice = useAppStore((s) => s.setSelectedMicrophoneDevice);

  const loadInputDevices = useCallback(async () => {
    try {
      const [cameraNames, microphoneNames] = await Promise.all([
        invoke<string[]>("list_camera_devices"),
        invoke<string[]>("list_microphone_devices"),
      ]);

      const nextCameras = cameraNames.map((name) => ({ id: name, name }));
      const nextMics = microphoneNames.map((name) => ({ id: name, name }));
      setCameraDevices(nextCameras);
      setMicrophoneDevices(nextMics);

      console.log("[InputDevices] Loaded cameras:", nextCameras.map(c => c.id));
      console.log("[InputDevices] Current selection:", selectedCameraDevice);

      // Auto-select first device only if persisted selection is no longer available.
      if (!selectedCameraDevice || !nextCameras.some((d) => d.id === selectedCameraDevice)) {
        const firstId = nextCameras[0]?.id ?? null;
        console.log("[InputDevices] Auto-selecting:", firstId);
        setSelectedCameraDevice(firstId);
      }
      if (!selectedMicrophoneDevice || !nextMics.some((d) => d.id === selectedMicrophoneDevice)) {
        setSelectedMicrophoneDevice(nextMics[0]?.id ?? null);
      }
    } catch {
      setCameraDevices([]);
      setMicrophoneDevices([]);
    }
  }, [selectedCameraDevice, selectedMicrophoneDevice, setSelectedCameraDevice, setSelectedMicrophoneDevice]);

  useEffect(() => {
    void loadInputDevices();
  }, [loadInputDevices]);

  return {
    cameraDevices,
    microphoneDevices,
    selectedCameraDevice,
    selectedMicrophoneDevice,
    setSelectedCameraDevice,
    setSelectedMicrophoneDevice,
    loadInputDevices,
  };
}
