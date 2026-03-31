// Application state
//
// Holds all mutable runtime state shared across Tauri commands.

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;

use crate::audio::AudioConfig;
use crate::capture::{ClickEvent, RawFrame, SessionCaptureConfig};
use crate::render::compositor::GpuInitStatus;

// ── GPU renderer state ────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct GpuRendererState {
    pub initialized: bool,
    pub adapter_name: Option<String>,
    pub backend: Option<String>,
}

// ── Recorder inner state ──────────────────────────────────────────────────────

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
    /// Path to the session folder written to disk after the last recording.
    pub session_folder: Option<String>,
    /// Path to the proxy MP4 (set after generate_preview_proxy succeeds).
    pub proxy_path: Option<String>,
}

// ── Top-level app state ───────────────────────────────────────────────────────

#[derive(Default)]
pub struct AppState {
    pub recorder: Mutex<RecorderInner>,
    pub gpu_renderer: Mutex<GpuRendererState>,
    pub audio_config: Mutex<AudioConfig>,
}
