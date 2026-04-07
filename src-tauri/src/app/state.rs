// Application state
//
// Holds all mutable runtime state shared across Tauri commands.

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;

use crate::audio::{AudioCaptureHandles, AudioConfig};
use crate::camera::CameraRecording;
use crate::capture::{ClickEvent, RawFrame, SessionCaptureConfig};

// ── GPU renderer state ────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct GpuRendererState {
    pub initialized: bool,
    pub adapter_name: Option<String>,
    pub backend: Option<String>,
}

// ── Recorder inner state ──────────────────────────────────────────────────────

#[derive(Debug)]
pub struct RecorderInner {
    pub is_recording: bool,
    pub is_paused: bool,
    pub target_fps: u32,
    pub started_at: Option<Instant>,
    pub last_session_duration_ms: u128,
    pub session_capture: Option<SessionCaptureConfig>,
    pub stop_signal: Option<Arc<AtomicBool>>,
    pub pause_signal: Option<Arc<AtomicBool>>,
    /// Timestamp at which the current pause started (if currently paused).
    pub paused_at: Option<Instant>,
    /// Cumulative paused wall-clock time, not counting any current ongoing pause.
    pub total_paused_ms: u128,
    pub handle: Option<JoinHandle<()>>,
    /// Lightweight per-frame metadata retained in memory.
    pub raw_frames: Arc<Mutex<Vec<RawFrame>>>,
    pub click_events: Arc<Mutex<Vec<ClickEvent>>>,
    /// Path to the session folder written to disk after the last recording.
    pub session_folder: Option<String>,
    /// Path to the source MP4 written during recording.
    pub source_video_path: Option<String>,
    /// Path to the proxy MP4 (set after generate_preview_proxy succeeds).
    pub proxy_path: Option<String>,
    /// Path to the camera MP4 recorded alongside screen capture.
    pub camera_video_path: Option<String>,
    /// Raw video-only path (before audio mux). Renamed to source_video_path after mux.
    pub video_raw_path: Option<String>,
    /// Active audio capture threads and WAV output paths.
    pub audio_handles: Option<AudioCaptureHandles>,
    /// AudioConfig snapshot taken at recording start (needed at stop time for mux).
    pub audio_config_snapshot: AudioConfig,
    /// True while the background stop-processing thread (FFmpeg flush, audio mux,
    /// JSON persist) is still running after stop_recording returned.
    pub is_post_processing: bool,
}

// ── Top-level app state ───────────────────────────────────────────────────────

pub struct AppState {
    /// Wrapped in Arc so the background stop-processing thread can hold a
    /// clone and write `is_post_processing = false` when done.
    pub recorder: Arc<Mutex<RecorderInner>>,
    pub gpu_renderer: Mutex<GpuRendererState>,
    pub audio_config: Mutex<AudioConfig>,
    pub mic_meter_stop: Mutex<Option<Arc<AtomicBool>>>,
    pub mic_meter_handle: Mutex<Option<JoinHandle<()>>>,
    /// Active camera recording (set when recording starts with a camera device).
    pub camera_recording: Mutex<Option<CameraRecording>>,
}

impl Default for RecorderInner {
    fn default() -> Self {
        Self {
            is_recording: false,
            is_paused: false,
            target_fps: 60,
            started_at: None,
            last_session_duration_ms: 0,
            session_capture: None,
            stop_signal: None,
            pause_signal: None,
            paused_at: None,
            total_paused_ms: 0,
            handle: None,
            raw_frames: Arc::new(Mutex::new(Vec::new())),
            click_events: Arc::new(Mutex::new(Vec::new())),
            session_folder: None,
            source_video_path: None,
            proxy_path: None,
            camera_video_path: None,
            video_raw_path: None,
            audio_handles: None,
            audio_config_snapshot: AudioConfig::default(),
            is_post_processing: false,
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            recorder: Arc::new(Mutex::new(RecorderInner::default())),
            gpu_renderer: Mutex::new(GpuRendererState::default()),
            audio_config: Mutex::new(AudioConfig::default()),
            mic_meter_stop: Mutex::new(None),
            mic_meter_handle: Mutex::new(None),
            camera_recording: Mutex::new(None),
        }
    }
}
