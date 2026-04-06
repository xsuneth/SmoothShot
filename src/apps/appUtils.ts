import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  WINDOW_LABEL_CAMERA_PREVIEW,
  WINDOW_LABEL_DISPLAY_PICKER,
  WINDOW_LABEL_EDITOR,
  WINDOW_LABEL_MAIN,
} from "../lib/constants";
import type { AppView } from "../types";

function getWindowHintFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const hint = params.get("window");
  if (
    hint === WINDOW_LABEL_MAIN ||
    hint === WINDOW_LABEL_EDITOR ||
    hint === WINDOW_LABEL_DISPLAY_PICKER ||
    hint === WINDOW_LABEL_CAMERA_PREVIEW
  ) {
    return hint;
  }

  return null;
}

export function detectWindowLabel() {
  const hintedLabel = getWindowHintFromUrl();
  if (hintedLabel) {
    return hintedLabel;
  }

  try {
    return getCurrentWebviewWindow().label;
  } catch {
    try {
      return getCurrentWindow().label;
    } catch {
      return "main";
    }
  }
}

export function initialViewForWindow(label: string): AppView {
  if (label === WINDOW_LABEL_EDITOR) {
    return "editor";
  }

  if (label === WINDOW_LABEL_DISPLAY_PICKER) {
    return "displayPicker";
  }

  if (label === WINDOW_LABEL_CAMERA_PREVIEW) {
    return "cameraPreview";
  }

  return "launcher";
}
