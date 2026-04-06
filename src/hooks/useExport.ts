import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";

import type { ExportRecordingResponse, GpuInitStatus } from "../types";
import { toLocalFileUrl } from "../lib/utils";

export interface UseExportParams {
  maxZoom: number;
  zoomInMs: number;
  holdMs: number;
  zoomOutMs: number;
  onPreviewUrlChange: (url: string) => void;
  onPreviewDurationChange: (ms: number) => void;
  onSeekToStart: () => void;
  onPlaybackStop: () => void;
}

export interface UseExportResult {
  isExporting: boolean;
  exportPath: string;
  lastExport: ExportRecordingResponse | null;
  gpuStatus: GpuInitStatus | null;
  setExportPath: (path: string) => void;
  initializeGpuRenderer: () => Promise<void>;
  generateZoomPreview: () => Promise<void>;
  exportRecording: () => Promise<void>;
  openExportedFile: () => Promise<void>;
}

export function useExport({
  maxZoom,
  zoomInMs,
  holdMs,
  zoomOutMs,
  onPreviewUrlChange,
  onPreviewDurationChange,
  onSeekToStart,
  onPlaybackStop,
}: UseExportParams): UseExportResult {
  const [isExporting, setIsExporting] = useState(false);
  const [exportPath, setExportPath] = useState("");
  const [lastExport, setLastExport] = useState<ExportRecordingResponse | null>(null);
  const [gpuStatus, setGpuStatus] = useState<GpuInitStatus | null>(null);

  async function initializeGpuRenderer() {
    const next = await invoke<GpuInitStatus>("initialize_gpu_renderer");
    setGpuStatus(next);
  }

  async function generateZoomPreview() {
    await invoke("build_zoom_preview", {
      request: { limit: 420, zoomInMs, holdMs, zoomOutMs, maxZoom },
    });
  }

  async function exportRecording() {
    setIsExporting(true);
    try {
      const result = await invoke<ExportRecordingResponse>("export_recording_cmd", {
        request: {
          outputPath: exportPath.trim().length > 0 ? exportPath.trim() : null,
          maxZoom,
          zoomInMs,
          holdMs,
          zoomOutMs,
        },
      });
      setLastExport(result);
      onPreviewUrlChange(toLocalFileUrl(result.outputPath));
      onPreviewDurationChange(result.outputDurationMs);
      onSeekToStart();
      onPlaybackStop();
    } finally {
      setIsExporting(false);
    }
  }

  async function openExportedFile() {
    if (!lastExport) return;
    await openPath(lastExport.outputPath);
  }

  return {
    isExporting,
    exportPath,
    lastExport,
    gpuStatus,
    setExportPath,
    initializeGpuRenderer,
    generateZoomPreview,
    exportRecording,
    openExportedFile,
  };
}
