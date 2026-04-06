import { useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  EVT_PICKER_CLOSED,
  EVT_PICKER_DATA,
  EVT_PICKER_RECORD,
  EVT_PICKER_SELECT,
  WINDOW_LABEL_MAIN,
} from "../lib/constants";
import { DisplayPickerWindow } from "../components/DisplayPickerWindow";
import type { DisplayDescriptor } from "../types";

export function DisplayPickerApp() {
  const [displays, setDisplays] = useState<DisplayDescriptor[]>([]);
  const [displaySelection, setDisplaySelection] = useState("");
  const [previewsLoading, setPreviewsLoading] = useState(false);
  // Prevents focus-loss from closing the picker while it is still being positioned/loaded.
  const isReadyRef = useRef(false);

  useEffect(() => {
    let unlistenData: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    void getCurrentWebviewWindow()
      .listen<{ displaySelection: string; displays: DisplayDescriptor[]; previewsLoading: boolean }>(EVT_PICKER_DATA, (event) => {
        setDisplaySelection(event.payload.displaySelection);
        setDisplays(event.payload.displays);
        setPreviewsLoading(event.payload.previewsLoading);
        // Only allow focus-loss to close once the final data (with previews) has arrived.
        isReadyRef.current = !event.payload.previewsLoading;
      })
      .then((dispose) => {
        unlistenData = dispose;
      })
      .catch(() => {
        // Ignore listener registration issues on startup.
      });

    void getCurrentWindow()
      .onFocusChanged(async ({ payload: focused }) => {
        if (!focused && isReadyRef.current) {
          isReadyRef.current = false;
          await getCurrentWindow().hide().catch(() => {
            // Ignore popup hide failures.
          });
          await getCurrentWebviewWindow().emitTo(WINDOW_LABEL_MAIN, EVT_PICKER_CLOSED).catch(() => {
            // Ignore close sync failures.
          });
        }
      })
      .then((dispose) => {
        unlistenFocus = dispose;
      })
      .catch(() => {
        // Ignore focus listener registration issues on startup.
      });

    return () => {
      unlistenData?.();
      unlistenFocus?.();
    };
  }, []);

  return (
    <DisplayPickerWindow
      displays={displays}
      displaySelection={displaySelection}
      previewsLoading={previewsLoading}
      onSelect={(selection) => {
        void getCurrentWebviewWindow()
          .emitTo(WINDOW_LABEL_MAIN, EVT_PICKER_SELECT, selection)
          .then(async () => {
            await getCurrentWebviewWindow().hide();
            await getCurrentWebviewWindow().emitTo(WINDOW_LABEL_MAIN, EVT_PICKER_CLOSED);
          })
          .catch(() => {
            // Ignore popup dispatch failures.
          });
      }}
      onRecord={(selection) => {
        void getCurrentWebviewWindow()
          .emitTo(WINDOW_LABEL_MAIN, EVT_PICKER_RECORD, selection)
          .then(async () => {
            await getCurrentWebviewWindow().hide();
            await getCurrentWebviewWindow().emitTo(WINDOW_LABEL_MAIN, EVT_PICKER_CLOSED);
          })
          .catch(() => {
            // Ignore popup dispatch failures.
          });
      }}
    />
  );
}
