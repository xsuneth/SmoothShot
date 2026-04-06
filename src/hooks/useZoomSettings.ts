import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { ZoomPreviewResponse } from "../types";

export interface UseZoomSettingsResult {
  maxZoom: number;
  zoomInMs: number;
  holdMs: number;
  zoomOutMs: number;
  zoomPreview: ZoomPreviewResponse | null;
  setMaxZoom: (v: number) => void;
  setZoomInMs: (v: number) => void;
  setHoldMs: (v: number) => void;
  setZoomOutMs: (v: number) => void;
  generateZoomPreview: () => Promise<void>;
}

export function useZoomSettings(): UseZoomSettingsResult {
  const [maxZoom, setMaxZoom] = useState(1.85);
  const [zoomInMs, setZoomInMs] = useState(180);
  const [holdMs, setHoldMs] = useState(120);
  const [zoomOutMs, setZoomOutMs] = useState(260);
  const [zoomPreview, setZoomPreview] = useState<ZoomPreviewResponse | null>(null);

  async function generateZoomPreview() {
    const preview = await invoke<ZoomPreviewResponse>("build_zoom_preview", {
      request: { limit: 420, zoomInMs, holdMs, zoomOutMs, maxZoom },
    });
    setZoomPreview(preview);
  }

  return {
    maxZoom,
    zoomInMs,
    holdMs,
    zoomOutMs,
    zoomPreview,
    setMaxZoom,
    setZoomInMs,
    setHoldMs,
    setZoomOutMs,
    generateZoomPreview,
  };
}
