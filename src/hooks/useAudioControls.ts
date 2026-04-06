import { useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import { buildAudioConfig } from "../lib/utils";
import { useAppStore } from "../store/useAppStore";

export interface UseAudioControlsResult {
  micEnabled: boolean;
  appAudioEnabled: boolean;
  toggleMic: () => Promise<void>;
  toggleAppAudio: () => Promise<void>;
}

export function useAudioControls(): UseAudioControlsResult {
  const micEnabled = useAppStore((s) => s.micEnabled);
  const appAudioEnabled = useAppStore((s) => s.appAudioEnabled);
  const setMicEnabled = useAppStore((s) => s.setMicEnabled);
  const setAppAudioEnabled = useAppStore((s) => s.setAppAudioEnabled);

  // Sync persisted audio state to the Rust backend on startup.
  // Without this, the mic meter thread is never started when the app opens
  // with mic already enabled from a previous session.
  useEffect(() => {
    void invoke("set_audio_config", {
      config: buildAudioConfig(appAudioEnabled, micEnabled),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount only

  const toggleMic = useCallback(async () => {
    const next = !micEnabled;
    setMicEnabled(next);
    try {
      await invoke("set_audio_config", {
        config: buildAudioConfig(appAudioEnabled, next),
      });
    } catch {
      setMicEnabled(!next); // revert on error
    }
  }, [appAudioEnabled, micEnabled, setMicEnabled]);

  const toggleAppAudio = useCallback(async () => {
    const next = !appAudioEnabled;
    setAppAudioEnabled(next);
    try {
      await invoke("set_audio_config", {
        config: buildAudioConfig(next, micEnabled),
      });
    } catch {
      setAppAudioEnabled(!next); // revert on error
    }
  }, [appAudioEnabled, micEnabled, setAppAudioEnabled]);

  return { micEnabled, appAudioEnabled, toggleMic, toggleAppAudio };
}
