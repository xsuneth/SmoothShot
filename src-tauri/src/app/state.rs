use std::sync::{Arc, Mutex};
use std::sync::atomic::AtomicBool;
use std::thread::JoinHandle;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::render::compositor::GpuRendererState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRecordingRequest {
    pub fps: Option<u32>,
    pub region: Option<CaptureRegion>,
    pub display_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameMetadata {
    pub frame_index: u64,
    pub timestamp_ms: u128,
    pub width: u32,
    pub height: u32,
    pub raw_bytes: usize,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub click_in_frame: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickEvent {
    pub timestamp_ms: u128,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub button: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomTransformFrame {
    pub frame_index: u64,
    pub timestamp_ms: u128,
    pub zoom: f32,
    pub focus_x: i32,
    pub focus_y: i32,
    pub click_driven: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomProfile {
    pub zoom_in_ms: u128,
    pub hold_ms: u128,
    pub zoom_out_ms: u128,
    pub max_zoom: f32,
    pub easing: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomPreviewResponse {
    pub frames: Vec<ZoomTransformFrame>,
    pub click_count: usize,
    pub profile: ZoomProfile,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomPreviewRequest {
    pub limit: Option<usize>,
    pub zoom_in_ms: Option<u128>,
    pub hold_ms: Option<u128>,
    pub zoom_out_ms: Option<u128>,
    pub max_zoom: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayDescriptor {
    pub index: usize,
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub scale_factor: f32,
    pub frequency: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRecordingRequest {
    pub output_path: Option<String>,
    pub max_zoom: Option<f32>,
    pub zoom_in_ms: Option<u128>,
    pub hold_ms: Option<u128>,
    pub zoom_out_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRecordingResponse {
    pub output_path: String,
    pub frames_exported: usize,
    pub width: u32,
    pub height: u32,
    pub target_fps: u32,
    pub output_duration_ms: u128,
}

#[derive(Debug, Clone)]
pub struct SessionCaptureConfig {
    pub display_origin_x: i32,
    pub display_origin_y: i32,
    pub region: Option<CaptureRegion>,
}

#[derive(Debug, Clone, Copy)]
pub struct ExportFrameSample {
    pub left_index: usize,
    pub right_index: usize,
    pub blend: f32,
    pub timestamp_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub target_fps: u32,
    pub frames_captured: usize,
    pub clicks_detected: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopRecordingResponse {
    pub target_fps: u32,
    pub duration_ms: u128,
    pub frames_captured: usize,
    pub clicks_detected: usize,
}

#[derive(Debug)]
pub struct RawFrame {
    pub timestamp_ms: u128,
    pub width: u32,
    pub height: u32,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub pixels_rgba: Vec<u8>,
}

#[derive(Debug, Default)]
pub struct RecorderInner {
    pub is_recording: bool,
    pub target_fps: u32,
    pub started_at: Option<Instant>,
    pub last_session_duration_ms: u128,
    pub session_capture: Option<SessionCaptureConfig>,
    pub stop_signal: Option<Arc<AtomicBool>>,
    pub handle: Option<JoinHandle<()>>,
    pub raw_frames: Arc<Mutex<Vec<RawFrame>>>,
    pub click_events: Arc<Mutex<Vec<ClickEvent>>>,
}

#[derive(Default)]
pub struct AppState {
    pub recorder: Mutex<RecorderInner>,
    pub gpu_renderer: Mutex<GpuRendererState>,
}
