export type CaptureRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RecordingStatus = {
  isRecording: boolean;
  targetFps: number;
  framesCaptured: number;
  clicksDetected: number;
};

export type StopRecordingResponse = {
  targetFps: number;
  durationMs: number;
  framesCaptured: number;
  clicksDetected: number;
};

export type ClickEvent = {
  timestampMs: number;
  cursorX: number;
  cursorY: number;
  button: string;
};

export type GpuInitStatus = {
  initialized: boolean;
  adapterName: string | null;
  backend: string | null;
};

export type ZoomProfile = {
  zoomInMs: number;
  holdMs: number;
  zoomOutMs: number;
  maxZoom: number;
  easing: string;
};

export type ZoomTransformFrame = {
  frameIndex: number;
  timestampMs: number;
  zoom: number;
  focusX: number;
  focusY: number;
  clickDriven: boolean;
};

export type ZoomPreviewResponse = {
  frames: ZoomTransformFrame[];
  clickCount: number;
  profile: ZoomProfile;
};

export type ExportRecordingResponse = {
  outputPath: string;
  framesExported: number;
  width: number;
  height: number;
  targetFps: number;
  outputDurationMs: number;
};

export type DisplayDescriptor = {
  index: number;
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isPrimary: boolean;
  scaleFactor: number;
  frequency: number;
};

export type LauncherMode = "display" | "window" | "area" | "device";
export type AppView = "launcher" | "editor";

export type ZoomMarker = {
  id: string;
  label: string;
  timeMs: number;
};

export type BackgroundTab = "wallpaper" | "gradient" | "color" | "image";

export type BackgroundStyle = {
  tab: BackgroundTab;
  value: string;
  blur: number;
};
