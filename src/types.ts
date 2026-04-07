export type CaptureRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StartRecordingRequest = {
  fps: number;
  region: CaptureRegion | null;
  displayIndex: number | null;
};

export type RecordingStatus = {
  isRecording: boolean;
  isPaused: boolean;
  targetFps: number;
  framesCaptured: number;
  clicksDetected: number;
  /** Wall-clock recording time excluding paused intervals (ms). */
  elapsedMs: number;
  /** Session folder path — set when recording is active. */
  sessionFolder: string | null;
};

export type StopRecordingResponse = {
  targetFps: number;
  durationMs: number;
  framesCaptured: number;
  clicksDetected: number;
  /** Path to the session folder written to disk (if persistence succeeded). */
  sessionFolder: string | null;
  /** Path to the captured source MP4 written during recording. */
  sourceVideoPath: string | null;
  /** Path to the proxy MP4 (set after calling generate_preview_proxy). */
  proxyPath: string | null;
  /** Path to the camera MP4 recorded alongside screen capture. */
  cameraVideoPath: string | null;
  /**
   * True while FFmpeg finalization, audio mux, and JSON persistence run in the
   * background.  The editor shows a loading bar and sets previewUrl only after
   * this becomes false (signalled by a second `smoothshot:session-updated`).
   */
  isProcessing?: boolean;
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
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isPrimary: boolean;
  scaleFactor: number;
  frequency: number;
  previewPath?: string | null;
};

export type LauncherMode = "display" | "window" | "area";
export type AppView = "launcher" | "editor" | "displayPicker" | "cameraPreview" | "countdown";

export type ZoomMarker = {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
};

export type BackgroundTab = "wallpaper" | "gradient" | "color" | "image";

export type BackgroundStyle = {
  tab: BackgroundTab;
  value: string;
  blur: number;
};

export type PreviewToolPanel = "Background" | "Cursor" | "Camera" | "Caption" | "Audio";
export type CameraCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type GeneratePreviewProxyResponse = {
  proxyPath: string;
  durationMs: number;
  width: number;
  height: number;
  targetFps: number;
};

export type FrameMetadata = {
  frameIndex: number;
  timestampMs: number;
  width: number;
  height: number;
  rawBytes: number;
  /** Display-local X coordinate (0 = left edge of capture area). */
  cursorX: number;
  /** Display-local Y coordinate (0 = top edge of capture area). */
  cursorY: number;
  clickInFrame: boolean;
  /** CSS cursor name: "default" | "text" | "pointer" | "crosshair" | "move" | "wait" | "not-allowed" | "*-resize" */
  cursorType: string;
};

export type PreviewFrameResponse = {
  timestampMs: number;
  width: number;
  height: number;
  pixelsRgba: number[];
};

export type AudioStatus = {
  systemAudioAvailable: boolean;
  micAvailable: boolean;
  systemAudioEnabled: boolean;
  micEnabled: boolean;
  systemAudioGain: number;
  micGain: number;
};

export type AudioConfig = {
  systemAudioEnabled: boolean;
  micEnabled: boolean;
  systemAudioGain: number;
  micGain: number;
};

export type InputDeviceOption = {
  id: string;
  name: string;
};

