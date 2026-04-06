import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

import {
  DISPLAY_PICKER_GAP,
  EVT_PICKER_DATA,
  WINDOW_LABEL_DISPLAY_PICKER,
} from "../lib/constants";
import { getDisplayPickerSize } from "../lib/utils";
import type { DisplayDescriptor } from "../types";

/** ms to ignore re-open requests after the picker closes (prevents toggle-race). */
const REOPEN_COOLDOWN_MS = 250;

/** Stable key for comparing display identity/layout — excludes the preview path. */
function displayMetaKey(d: DisplayDescriptor) {
  return `${d.id}:${d.width}x${d.height}@${d.frequency}`;
}

function displaysChanged(prev: DisplayDescriptor[], next: DisplayDescriptor[]) {
  if (prev.length !== next.length) return true;
  return prev.some((p, i) => displayMetaKey(p) !== displayMetaKey(next[i]));
}

/**
 * Controls the lifecycle of the floating display-picker window.
 */
export interface UseDisplayPickerResult {
  isDisplayPickerOpen: boolean;
  showDisplayMenu: (anchorX: number, anchorY: number) => Promise<void>;
  hideDisplayPopup: () => Promise<void>;
  setPickerOpen: (open: boolean) => void;
}

interface UseDisplayPickerParams {
  displays: DisplayDescriptor[];
  displaySelection: string;
  loadDisplays: (opts?: { includePreviews?: boolean }) => Promise<DisplayDescriptor[]>;
  setMessage: (message: string) => void;
}

export function useDisplayPicker({
  displays,
  displaySelection,
  loadDisplays,
  setMessage,
}: UseDisplayPickerParams): UseDisplayPickerResult {
  const [isDisplayPickerOpen, setIsDisplayPickerOpen] = useState(false);
  /** Timestamp of last close — used to prevent the toggle-race re-open. */
  const lastClosedRef = useRef(0);

  const hideDisplayPopup = useCallback(async () => {
    lastClosedRef.current = Date.now();
    setIsDisplayPickerOpen(false);
    const popup = await WebviewWindow.getByLabel(WINDOW_LABEL_DISPLAY_PICKER);
    if (popup) {
      await popup.hide().catch(() => {
        // Ignore popup hide failures.
      });
    }
  }, []);

  /** Wraps the raw setter so external callers also stamp the close time. */
  const setPickerOpen = useCallback((open: boolean) => {
    if (!open) lastClosedRef.current = Date.now();
    setIsDisplayPickerOpen(open);
  }, []);

  const showDisplayMenu = useCallback(async (_anchorX: number, _anchorY: number) => {
    void _anchorX;
    void _anchorY;

    // Prevent re-open caused by the button click that triggered the focus-loss close.
    if (Date.now() - lastClosedRef.current < REOPEN_COOLDOWN_MS) return;

    try {
      const currentWindow = getCurrentWindow();
      const windowPosition = await currentWindow.outerPosition();
      const windowSize = await currentWindow.outerSize();
      const popupSize = getDisplayPickerSize(Math.max(1, displays.length));
      const monitor = await currentMonitor();

      const toPopupPosition = (size: { width: number; height: number }) => {
        const desiredX = Math.round(windowPosition.x + (windowSize.width - size.width) / 2);
        const desiredY = Math.round(windowPosition.y - size.height - DISPLAY_PICKER_GAP);

        if (!monitor) {
          return { x: desiredX, y: desiredY };
        }

        const minX = monitor.position.x;
        const minY = monitor.position.y;
        const maxX = monitor.position.x + monitor.size.width - size.width;
        const maxY = monitor.position.y + monitor.size.height - size.height;

        return {
          x: Math.max(minX, Math.min(desiredX, maxX)),
          y: Math.max(minY, Math.min(desiredY, maxY)),
        };
      };
      const initialPosition = toPopupPosition(popupSize);

      let popup = await WebviewWindow.getByLabel(WINDOW_LABEL_DISPLAY_PICKER);

      if (popup) {
        const isVisible = await popup.isVisible().catch(() => false);
        if (isVisible) {
          await hideDisplayPopup();
          return;
        }
      }

      if (!popup) {
        const createdWindow = new WebviewWindow(WINDOW_LABEL_DISPLAY_PICKER, {
          url: `/?window=${WINDOW_LABEL_DISPLAY_PICKER}`,
          title: "Display Picker",
          width: popupSize.width,
          height: popupSize.height,
          minWidth: popupSize.width,
          minHeight: popupSize.height,
          maxWidth: popupSize.width,
          maxHeight: popupSize.height,
          decorations: false,
          transparent: true,
          shadow: false,
          alwaysOnTop: true,
          focus: true,
          visible: false,
          skipTaskbar: true,
          resizable: false,
        });

        await new Promise<void>((resolve, reject) => {
          const onCreated = () => resolve();
          const onError = (event: unknown) => reject(new Error(String(event)));
          void createdWindow.once("tauri://created", onCreated);
          void createdWindow.once("tauri://error", onError);
        });

        // Exclude this window from screen capture (non-fatal if it fails).
        void invoke("mark_window_excluded", { label: WINDOW_LABEL_DISPLAY_PICKER }).catch(
          () => undefined,
        );

        for (let attempt = 0; attempt < 40; attempt += 1) {
          popup = await WebviewWindow.getByLabel(WINDOW_LABEL_DISPLAY_PICKER);
          if (popup) {
            break;
          }

          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 50);
          });
        }

        if (!popup) {
          throw new Error("display-picker window was not created");
        }
      }

      await popup.setSize(new LogicalSize(popupSize.width, popupSize.height));
      await popup.setPosition(new PhysicalPosition(initialPosition.x, initialPosition.y));
      await popup.show();
      await popup.setFocus();
      setIsDisplayPickerOpen(true);

      // ── Phase 1: show cached info immediately, preview thumbnails loading ──
      await popup.emit(EVT_PICKER_DATA, {
        displaySelection,
        displays,           // cached — may be empty on very first open
        previewsLoading: true,
      });

      // ── Phase 2: fetch fresh data with screenshots ──
      const freshDisplays = await loadDisplays({ includePreviews: true });

      // Resize only when the number of displays changed.
      if (freshDisplays.length !== displays.length) {
        const freshSize = getDisplayPickerSize(freshDisplays.length);
        const freshPosition = toPopupPosition(freshSize);
        await popup.setSize(new LogicalSize(freshSize.width, freshSize.height));
        await popup.setPosition(new PhysicalPosition(freshPosition.x, freshPosition.y));
        await popup.setFocus();
      }

      // Send fresh data. If display metadata hasn't changed, the info part of the
      // UI won't visually update — only the preview thumbnails will change.
      const infoChanged = displaysChanged(displays, freshDisplays);
      await popup.emit(EVT_PICKER_DATA, {
        displaySelection,
        displays: infoChanged ? freshDisplays : freshDisplays, // always send fresh previews
        previewsLoading: false,
      });
    } catch (error) {
      setIsDisplayPickerOpen(false);
      console.error("[DisplayPicker] Could not open display picker:", error);
      setMessage(`Could not open display picker: ${String(error)}`);
    }
  }, [displaySelection, displays, hideDisplayPopup, loadDisplays, setMessage]);

  return {
    isDisplayPickerOpen,
    showDisplayMenu,
    hideDisplayPopup,
    setPickerOpen,
  };
}
