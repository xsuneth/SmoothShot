import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { LauncherMode } from "../types";

// ── Shape ─────────────────────────────────────────────────────────────────────

type AppSettings = {
  // Camera
  cameraEnabled: boolean;
  selectedCameraDevice: string | null;
  // Audio
  micEnabled: boolean;
  appAudioEnabled: boolean;
  selectedMicrophoneDevice: string | null;
  // Recording
  launcherMode: LauncherMode | null;
  displaySelection: string;
  fps: number;
};

type AppActions = {
  setCameraEnabled: (v: boolean) => void;
  setSelectedCameraDevice: (v: string | null) => void;
  setMicEnabled: (v: boolean) => void;
  setAppAudioEnabled: (v: boolean) => void;
  setSelectedMicrophoneDevice: (v: string | null) => void;
  setLauncherMode: (v: LauncherMode | null) => void;
  setDisplaySelection: (v: string) => void;
  setFps: (v: number) => void;
};

// ── Defaults ──────────────────────────────────────────────────────────────────

const defaults: AppSettings = {
  cameraEnabled: false,
  selectedCameraDevice: null,
  micEnabled: false,
  appAudioEnabled: true,
  selectedMicrophoneDevice: null,
  launcherMode: null,
  displaySelection: "",
  fps: 60,
};

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppSettings & AppActions>()(
  persist(
    (set) => ({
      ...defaults,
      setCameraEnabled: (v) => set({ cameraEnabled: v }),
      setSelectedCameraDevice: (v) => set({ selectedCameraDevice: v }),
      setMicEnabled: (v) => set({ micEnabled: v }),
      setAppAudioEnabled: (v) => set({ appAudioEnabled: v }),
      setSelectedMicrophoneDevice: (v) => set({ selectedMicrophoneDevice: v }),
      setLauncherMode: (v) => set({ launcherMode: v }),
      setDisplaySelection: (v) => set({ displaySelection: v }),
      setFps: (v) => set({ fps: v }),
    }),
    {
      name: "smoothshot-settings",
      storage: createJSONStorage(() => localStorage),
      // Only persist user-configurable settings, not transient runtime state.
      partialize: (state): AppSettings => ({
        cameraEnabled: state.cameraEnabled,
        selectedCameraDevice: state.selectedCameraDevice,
        micEnabled: state.micEnabled,
        appAudioEnabled: state.appAudioEnabled,
        selectedMicrophoneDevice: state.selectedMicrophoneDevice,
        launcherMode: state.launcherMode,
        displaySelection: state.displaySelection,
        fps: state.fps,
      }),
    },
  ),
);
