import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  EVT_MIC_LEVEL,
  EVT_PICKER_CLOSED,
  EVT_PICKER_RECORD,
  EVT_PICKER_SELECT,
  WINDOW_LABEL_MAIN,
} from "../lib/constants";

/**
 * Registers launcher-window event listeners for mic level, picker events, and window movement.
 */
export interface UseLauncherEventsResult {
  initialized: boolean;
}

interface UseLauncherEventsParams {
  windowLabel: string;
  onMicLevel: (level: number) => void;
  onPickerSelect: (selection: string) => Promise<void>;
  onPickerRecord: (selection: string) => Promise<void>;
  onPickerClosed: () => Promise<void>;
  onWindowMoved: () => Promise<void>;
}

export function useLauncherEvents({
  windowLabel,
  onMicLevel,
  onPickerSelect,
  onPickerRecord,
  onPickerClosed,
  onWindowMoved,
}: UseLauncherEventsParams): UseLauncherEventsResult {
  useEffect(() => {
    if (windowLabel !== WINDOW_LABEL_MAIN) {
      return;
    }

    let unlistenMic: (() => void) | undefined;
    let unlistenSelect: (() => void) | undefined;
    let unlistenRecord: (() => void) | undefined;
    let unlistenMoved: (() => void) | undefined;
    let unlistenClosed: (() => void) | undefined;

    void getCurrentWebviewWindow()
      .listen<number>(EVT_MIC_LEVEL, (event) => {
        onMicLevel(Math.min(1, Math.max(0, Number(event.payload) || 0)));
      })
      .then((dispose) => {
        unlistenMic = dispose;
      })
      .catch(() => {
        // Ignore listener registration issues on startup.
      });

    void getCurrentWebviewWindow()
      .listen<string>(EVT_PICKER_SELECT, (event) => {
        void onPickerSelect(event.payload);
      })
      .then((dispose) => {
        unlistenSelect = dispose;
      })
      .catch(() => {
        // Ignore listener registration issues on startup.
      });

    void getCurrentWebviewWindow()
      .listen<string>(EVT_PICKER_RECORD, (event) => {
        void onPickerRecord(event.payload);
      })
      .then((dispose) => {
        unlistenRecord = dispose;
      })
      .catch(() => {
        // Ignore listener registration issues on startup.
      });

    void getCurrentWebviewWindow()
      .listen(EVT_PICKER_CLOSED, () => {
        void onPickerClosed();
      })
      .then((dispose) => {
        unlistenClosed = dispose;
      })
      .catch(() => {
        // Ignore listener registration issues on startup.
      });

    void getCurrentWindow()
      .onMoved(() => {
        void onWindowMoved();
      })
      .then((dispose) => {
        unlistenMoved = dispose;
      })
      .catch(() => {
        // Ignore listener registration issues on startup.
      });

    return () => {
      unlistenMic?.();
      unlistenSelect?.();
      unlistenRecord?.();
      unlistenMoved?.();
      unlistenClosed?.();
    };
  }, [windowLabel, onMicLevel, onPickerSelect, onPickerRecord, onPickerClosed, onWindowMoved]);

  return { initialized: true };
}
