// Tauri command handlers
//
// All `#[tauri::command]` functions live here.  They receive the shared
// `AppState` and delegate to the appropriate subsystem modules.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

use screenshots::Screen;
use serde::Deserialize;

use crate::app::state::AppState;
use crate::audio::{
    list_dshow_video_devices, list_input_mic_devices, start_audio_capture, stop_and_mux_audio,
    AudioConfig, AudioStatus,
};
use crate::capture::{
    build_frame_metadata, capture_loop, resolve_capture_screen, ClickEvent, DisplayDescriptor,
    FrameMetadata, PreviewFrameResponse, RecordingStatus, SessionCaptureConfig,
    StartRecordingRequest, StopRecordingResponse,
};
use crate::export::exporter::{export_recording, ExportRecordingRequest, ExportRecordingResponse};
use crate::preview::preview_session::{generate_proxy, GeneratePreviewProxyResponse};
use crate::project::persistence::{create_session_folder, persist_session_in_folder};
use crate::project::project_model::{CursorEventRecord, ProjectFile};
use crate::render::compositor::{init_gpu, GpuInitStatus};
use crate::timeline::zoom_track::{
    zoom_from_click, ZoomPreviewRequest, ZoomPreviewResponse, ZoomTransformFrame,
};

// ── Recording commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn start_recording(
    state: tauri::State<'_, AppState>,
    request: Option<StartRecordingRequest>,
    camera_device: Option<String>,
) -> Result<RecordingStatus, String> {
    let mut recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    if recorder.is_recording {
        return Err("recording is already running".to_string());
    }

    let request = request.unwrap_or(StartRecordingRequest {
        fps: None,
        region: None,
        display_index: None,
    });

    let target_fps = request.fps.unwrap_or(60).clamp(24, 60);
    let region = request.region.clone();
    let display_index = request.display_index;
    let screens = Screen::all().map_err(|err| format!("failed to enumerate displays: {err}"))?;

    use device_query::{DeviceQuery, DeviceState};
    let device_state = DeviceState::new();
    let initial_mouse = device_state.get_mouse();
    let preferred_point = region
        .as_ref()
        .map(|area| (area.x, area.y))
        .unwrap_or(initial_mouse.coords);

    let capture_screen = resolve_capture_screen(
        &screens,
        display_index,
        preferred_point.0,
        preferred_point.1,
    )
    .ok_or_else(|| "failed to pick capture display".to_string())?;

    let stop_signal = Arc::new(AtomicBool::new(false));
    let pause_signal = Arc::new(AtomicBool::new(false));
    let started_at = std::time::Instant::now();
    let raw_frames = Arc::new(Mutex::new(Vec::new()));
    let click_events = Arc::new(Mutex::new(Vec::new()));
    let audio_config = state
        .audio_config
        .lock()
        .map_err(|_| "failed to lock audio config".to_string())?
        .clone();
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let session_folder = create_session_folder(epoch)?;
    // video_raw.mp4 = video-only; muxed into source.mp4 after stop.
    let video_raw_path = session_folder.join("video_raw.mp4");
    let source_video_path = session_folder.join("source.mp4");

    // Resolve the correct Windows capture monitor_idx by matching DXGI desktop coordinates.
    // The screenshots crate and DXGI may enumerate monitors in different orders, so
    // we match by origin rather than trusting the raw enumeration index.
    #[cfg(target_os = "windows")]
    let dxgi_output_idx = crate::capture::resolve_dxgi_output_idx(
        capture_screen.display_info.x,
        capture_screen.display_info.y,
    );
    #[cfg(not(target_os = "windows"))]
    let dxgi_output_idx = display_index.unwrap_or(0);

    let session_capture = SessionCaptureConfig {
        display_index: dxgi_output_idx,
        display_origin_x: capture_screen.display_info.x,
        display_origin_y: capture_screen.display_info.y,
        region: request.region,
        display_width: capture_screen.display_info.width,
        display_height: capture_screen.display_info.height,
        source_width: region
            .as_ref()
            .map(|area| area.width)
            .unwrap_or(capture_screen.display_info.width),
        source_height: region
            .as_ref()
            .map(|area| area.height)
            .unwrap_or(capture_screen.display_info.height),
    };

    let thread_stop = Arc::clone(&stop_signal);
    let thread_pause = Arc::clone(&pause_signal);
    let thread_frames = Arc::clone(&raw_frames);
    let thread_clicks = Arc::clone(&click_events);
    // Capture loop records video-only; audio is captured separately.
    let thread_video_raw_path = Some(video_raw_path.to_string_lossy().to_string());
    let thread_session_capture = session_capture.clone();
    let handle = thread::spawn(move || {
        capture_loop(
            target_fps,
            capture_screen,
            thread_session_capture,
            thread_stop,
            thread_pause,
            started_at,
            thread_frames,
            thread_clicks,
            thread_video_raw_path,
        )
    });

    // Start audio capture threads (system audio + mic WAV files).
    let audio_stop = Arc::clone(&stop_signal);
    let audio_handles = start_audio_capture(&session_folder, &audio_config, audio_stop, None);

    recorder.is_recording = true;
    recorder.is_post_processing = false;
    recorder.is_paused = false;
    recorder.target_fps = target_fps;
    recorder.started_at = Some(started_at);
    recorder.last_session_duration_ms = 0;
    recorder.total_paused_ms = 0;
    recorder.paused_at = None;
    recorder.session_capture = Some(session_capture);
    recorder.stop_signal = Some(stop_signal);
    recorder.pause_signal = Some(pause_signal);
    recorder.handle = Some(handle);
    recorder.raw_frames = raw_frames;
    recorder.click_events = click_events;
    recorder.session_folder = Some(session_folder.to_string_lossy().to_string());
    recorder.video_raw_path = Some(video_raw_path.to_string_lossy().to_string());
    recorder.source_video_path = Some(source_video_path.to_string_lossy().to_string());
    recorder.proxy_path = None;
    recorder.camera_video_path = None;
    recorder.audio_handles = Some(audio_handles);
    recorder.audio_config_snapshot = audio_config;

    // Camera recording is handled by the frontend via MediaRecorder (no device conflict).
    // The frontend will call set_camera_video_path once it has saved the file.
    let _ = camera_device; // consumed by frontend, not used here

    let session_folder_str = session_folder.to_string_lossy().to_string();

    Ok(RecordingStatus {
        is_recording: true,
        is_paused: false,
        target_fps,
        frames_captured: 0,
        clicks_detected: 0,
        elapsed_ms: 0,
        session_folder: Some(session_folder_str),
    })
}

#[tauri::command]
pub fn stop_recording(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<StopRecordingResponse, String> {
    // ── Phase 1: Lock briefly — signal stop and extract everything needed ─────
    // Return to the caller immediately with isProcessing = true.
    // All heavy work (FFmpeg finalize, audio mux, JSON persistence) runs in a
    // background thread so the UI stays fully responsive for long recordings.
    let bg_data = {
        let mut recorder = state
            .recorder
            .lock()
            .map_err(|_| "failed to lock recorder state".to_string())?;

        if !recorder.is_recording {
            return Err("no active recording session".to_string());
        }

        // Signal the capture thread and any pause to stop.
        let stop_signal_arc = recorder.stop_signal.take();
        if let Some(ref signal) = stop_signal_arc {
            signal.store(true, Ordering::Relaxed);
        }
        if let Some(signal) = recorder.pause_signal.take() {
            signal.store(true, Ordering::Relaxed);
        }

        // Compute duration before any wall-clock drift.
        let current_pause_ms = if recorder.is_paused {
            recorder.paused_at.map(|t| t.elapsed().as_millis()).unwrap_or_default()
        } else {
            0
        };
        recorder.is_paused = false;
        recorder.paused_at = None;
        let duration_ms = recorder
            .started_at
            .map(|start| start.elapsed().as_millis())
            .unwrap_or_default()
            .saturating_sub(recorder.total_paused_ms)
            .saturating_sub(current_pause_ms);
        recorder.total_paused_ms = 0;

        // Mark stopped immediately — all subsequent commands see the new state.
        recorder.is_recording = false;
        recorder.is_post_processing = true;
        recorder.last_session_duration_ms = duration_ms;

        // Collect frame / click counts and build persistence payloads.
        let frames_guard = recorder
            .raw_frames
            .lock()
            .map_err(|_| "failed to lock frame buffer".to_string())?;
        let frames_captured = frames_guard.len();
        let (source_width, source_height) = frames_guard
            .first()
            .map(|f| (f.width, f.height))
            .unwrap_or((0, 0));
        let cursor_events: Vec<CursorEventRecord> = frames_guard
            .iter()
            .map(|f| CursorEventRecord {
                timestamp_ms: f.timestamp_ms,
                x: f.cursor_x,
                y: f.cursor_y,
            })
            .collect();
        drop(frames_guard);

        let clicks_guard = recorder
            .click_events
            .lock()
            .map_err(|_| "failed to lock click events".to_string())?;
        let clicks_detected = clicks_guard.len();
        let click_events_for_disk: Vec<ClickEvent> = clicks_guard.clone();
        drop(clicks_guard);

        // Take ownership of items the background thread needs.
        let capture_handle = recorder.handle.take();
        let audio_handles = recorder.audio_handles.take();
        let video_raw_path = recorder.video_raw_path.take();
        let source_video_path_for_mux = recorder.source_video_path.clone();
        let audio_config_snapshot = recorder.audio_config_snapshot.clone();
        let stop_for_mux = stop_signal_arc
            .clone()
            .unwrap_or_else(|| Arc::new(AtomicBool::new(true)));

        let session_folder_str = recorder
            .session_folder
            .clone()
            .ok_or_else(|| "missing session folder".to_string())?;

        let project = ProjectFile {
            version: 1,
            session_id: std::path::Path::new(&session_folder_str)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("session")
                .to_string(),
            created_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            duration_ms,
            target_fps: recorder.target_fps,
            frames_captured,
            clicks_detected,
            source_width,
            source_height,
            source_video: Some("source.mp4".to_string()),
            proxy_video: None,
            cursor_events_file: "cursor_events.json".to_string(),
            click_events_file: "click_events.json".to_string(),
        };

        recorder.proxy_path = None;

        let response = StopRecordingResponse {
            target_fps: recorder.target_fps,
            duration_ms,
            frames_captured,
            clicks_detected,
            session_folder: recorder.session_folder.clone(),
            source_video_path: recorder.source_video_path.clone(),
            proxy_path: None,
            camera_video_path: recorder.camera_video_path.clone(),
            is_processing: true,
        };

        (
            response,
            capture_handle,
            audio_handles,
            video_raw_path,
            source_video_path_for_mux,
            audio_config_snapshot,
            stop_for_mux,
            session_folder_str,
            project,
            click_events_for_disk,
            cursor_events,
        )
        // mutex guard dropped — lock released
    };

    let (
        response,
        capture_handle,
        audio_handles,
        video_raw_path,
        source_video_path_for_mux,
        audio_config_snapshot,
        stop_for_mux,
        session_folder_str,
        project,
        click_events_for_disk,
        cursor_events,
    ) = bg_data;

    // ── Phase 2: Spawn background thread — mutex stays FREE ──────────────────
    // The thread does all the slow work: waiting for FFmpeg to finalize the
    // captured MP4 (seconds–minutes for long recordings), muxing audio, and
    // writing JSON metadata.  When done it emits `smoothshot:session-updated`
    // so the editor can load the video and dismiss its loading bar.
    let recorder_arc = state.recorder.clone();
    thread::spawn(move || {
        // Wait for the capture thread (FFmpeg gfxcapture) to flush and finalize.
        if let Some(h) = capture_handle {
            let _ = h.join();
        }

        // Join audio threads and mux WAV files into the source MP4.
        if let (Some(audio_handles), Some(video_raw), Some(source_video)) =
            (audio_handles, video_raw_path, source_video_path_for_mux)
        {
            if let Err(e) = stop_and_mux_audio(
                audio_handles,
                &stop_for_mux,
                std::path::Path::new(&video_raw),
                std::path::Path::new(&source_video),
                &audio_config_snapshot,
            ) {
                eprintln!("[stop_recording] audio mux failed (non-fatal): {e}");
                if !std::path::Path::new(&source_video).exists() {
                    let _ = std::fs::rename(&video_raw, &source_video);
                }
            }
        }

        // Persist project.json + cursor_events.json + click_events.json.
        let canonical_folder = persist_session_in_folder(
            std::path::Path::new(&session_folder_str),
            &project,
            &click_events_for_disk,
            &cursor_events,
        );

        // Write back the canonical folder and clear the processing flag.
        if let Ok(mut recorder) = recorder_arc.lock() {
            recorder.is_post_processing = false;
            if let Ok(folder) = canonical_folder {
                recorder.session_folder = Some(folder);
            }
        }

        // Notify the editor that the video is ready to load.
        if let Some(editor_win) = app_handle.get_webview_window("editor") {
            let _ = editor_win.emit("smoothshot:session-updated", ());
        }
    });

    // ── Return immediately — editor opens with a loading bar ─────────────────
    Ok(response)
}

#[tauri::command]
pub fn get_recording_status(state: tauri::State<'_, AppState>) -> Result<RecordingStatus, String> {
    let recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    let frames_captured = recorder
        .raw_frames
        .lock()
        .map_err(|_| "failed to lock frame buffer".to_string())?
        .len();

    let clicks_detected = recorder
        .click_events
        .lock()
        .map_err(|_| "failed to lock click events".to_string())?
        .len();

    // Elapsed time = wall clock since start, minus all paused intervals.
    let wall_elapsed = recorder
        .started_at
        .map(|t| t.elapsed().as_millis())
        .unwrap_or_default();
    let current_pause_ms = if recorder.is_paused {
        recorder.paused_at.map(|t| t.elapsed().as_millis()).unwrap_or_default()
    } else {
        0
    };
    let elapsed_ms = wall_elapsed
        .saturating_sub(recorder.total_paused_ms)
        .saturating_sub(current_pause_ms);

    Ok(RecordingStatus {
        is_recording: recorder.is_recording,
        is_paused: recorder.is_paused,
        target_fps: recorder.target_fps,
        frames_captured,
        clicks_detected,
        elapsed_ms,
        session_folder: recorder.session_folder.clone(),
    })
}

#[tauri::command]
pub fn pause_recording(state: tauri::State<'_, AppState>) -> Result<RecordingStatus, String> {
    let mut recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    if !recorder.is_recording || recorder.is_paused {
        return Err("not recording or already paused".to_string());
    }

    if let Some(signal) = &recorder.pause_signal {
        signal.store(true, Ordering::Relaxed);
    }
    recorder.is_paused = true;
    recorder.paused_at = Some(std::time::Instant::now());

    let elapsed_ms = recorder
        .started_at
        .map(|t| t.elapsed().as_millis())
        .unwrap_or_default()
        .saturating_sub(recorder.total_paused_ms);

    Ok(RecordingStatus {
        is_recording: true,
        is_paused: true,
        target_fps: recorder.target_fps,
        frames_captured: recorder.raw_frames.lock().map(|f| f.len()).unwrap_or(0),
        clicks_detected: recorder.click_events.lock().map(|e| e.len()).unwrap_or(0),
        elapsed_ms,
        session_folder: recorder.session_folder.clone(),
    })
}

#[tauri::command]
pub fn resume_recording(state: tauri::State<'_, AppState>) -> Result<RecordingStatus, String> {
    let mut recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    if !recorder.is_recording || !recorder.is_paused {
        return Err("not paused".to_string());
    }

    // Accumulate this pause interval.
    if let Some(paused_at) = recorder.paused_at.take() {
        recorder.total_paused_ms += paused_at.elapsed().as_millis();
    }
    if let Some(signal) = &recorder.pause_signal {
        signal.store(false, Ordering::Relaxed);
    }
    recorder.is_paused = false;

    let elapsed_ms = recorder
        .started_at
        .map(|t| t.elapsed().as_millis())
        .unwrap_or_default()
        .saturating_sub(recorder.total_paused_ms);

    Ok(RecordingStatus {
        is_recording: true,
        is_paused: false,
        target_fps: recorder.target_fps,
        frames_captured: recorder.raw_frames.lock().map(|f| f.len()).unwrap_or(0),
        clicks_detected: recorder.click_events.lock().map(|e| e.len()).unwrap_or(0),
        elapsed_ms,
        session_folder: recorder.session_folder.clone(),
    })
}

#[tauri::command]
pub fn delete_recording(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    if !recorder.is_recording {
        return Ok(());
    }

    // Signal and join the capture thread.
    if let Some(signal) = recorder.stop_signal.take() {
        signal.store(true, Ordering::Relaxed);
    }
    if let Some(signal) = recorder.pause_signal.take() {
        signal.store(true, Ordering::Relaxed);
    }
    if let Some(handle) = recorder.handle.take() {
        let _ = handle.join();
    }

    // Stop camera recording.
    if let Ok(mut cam) = state.camera_recording.lock() {
        if let Some(ref mut recording) = *cam {
            let _ = recording.stop();
        }
        *cam = None;
    }

    // Delete the session folder from disk.
    let folder = recorder.session_folder.clone();
    recorder.is_recording = false;
    recorder.is_paused = false;
    recorder.started_at = None;
    recorder.total_paused_ms = 0;
    recorder.paused_at = None;
    recorder.session_folder = None;
    recorder.source_video_path = None;
    recorder.proxy_path = None;
    recorder.camera_video_path = None;
    if let Ok(mut frames) = recorder.raw_frames.lock() { frames.clear(); }
    if let Ok(mut clicks) = recorder.click_events.lock() { clicks.clear(); }

    drop(recorder); // release lock before file I/O

    if let Some(folder_path) = folder {
        let _ = std::fs::remove_dir_all(folder_path);
    }

    Ok(())
}

/// Append a chunk of bytes to a file (used by the frontend MediaRecorder camera capture).
#[tauri::command]
pub fn append_camera_chunk(path: String, chunk: Vec<u8>) -> Result<(), String> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open camera chunk file: {e}"))?;
    file.write_all(&chunk)
        .map_err(|e| format!("write camera chunk: {e}"))?;
    Ok(())
}

/// Called by the frontend when MediaRecorder has finished saving the camera file.
#[tauri::command]
pub fn set_camera_video_path(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let mut recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;
    recorder.camera_video_path = Some(path);
    Ok(())
}

#[tauri::command]
pub fn get_camera_url(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    let recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;
    Ok(recorder.camera_video_path.clone())
}

#[tauri::command]
pub fn get_click_timeline(state: tauri::State<'_, AppState>) -> Result<Vec<ClickEvent>, String> {
    let recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    let events = recorder
        .click_events
        .lock()
        .map_err(|_| "failed to lock click events".to_string())?
        .clone();

    Ok(events)
}


#[tauri::command]
pub fn get_last_session_summary(
    state: tauri::State<'_, AppState>,
) -> Result<Option<StopRecordingResponse>, String> {
    let recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    if recorder.is_recording {
        return Ok(None);
    }

    let frames_captured = recorder
        .raw_frames
        .lock()
        .map_err(|_| "failed to lock frame buffer".to_string())?
        .len();

    if frames_captured == 0 {
        return Ok(None);
    }

    let clicks_detected = recorder
        .click_events
        .lock()
        .map_err(|_| "failed to lock click events".to_string())?
        .len();

    Ok(Some(StopRecordingResponse {
        target_fps: recorder.target_fps,
        duration_ms: recorder.last_session_duration_ms,
        frames_captured,
        clicks_detected,
        session_folder: recorder.session_folder.clone(),
        source_video_path: recorder.source_video_path.clone(),
        proxy_path: recorder.proxy_path.clone(),
        camera_video_path: recorder.camera_video_path.clone(),
        is_processing: recorder.is_post_processing,
    }))
}

#[tauri::command]
pub fn get_frame_timeline(
    state: tauri::State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<FrameMetadata>, String> {
    let recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    let frames = recorder
        .raw_frames
        .lock()
        .map_err(|_| "failed to lock frame buffer".to_string())?;
    let clicks = recorder
        .click_events
        .lock()
        .map_err(|_| "failed to lock click events".to_string())?;

    Ok(build_frame_metadata(
        &frames,
        &clicks,
        recorder.target_fps,
        limit.unwrap_or(300),
    ))
}

#[tauri::command]
pub fn get_preview_frame(
    state: tauri::State<'_, AppState>,
    time_ms: Option<u128>,
) -> Result<Option<PreviewFrameResponse>, String> {
    let recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    let frames = recorder
        .raw_frames
        .lock()
        .map_err(|_| "failed to lock frame buffer".to_string())?;

    if frames.is_empty() {
        return Ok(None);
    }

    let target_time =
        time_ms.unwrap_or_else(|| frames.last().map(|frame| frame.timestamp_ms).unwrap_or(0));
    let mut best_index = 0usize;
    let mut best_distance = u128::MAX;

    for (index, frame) in frames.iter().enumerate() {
        let distance = frame.timestamp_ms.abs_diff(target_time);
        if distance < best_distance {
            best_distance = distance;
            best_index = index;
        }
    }

    let frame = &frames[best_index];

    Ok(Some(PreviewFrameResponse {
        timestamp_ms: frame.timestamp_ms,
        width: frame.width,
        height: frame.height,
        pixels_rgba: frame.pixels_rgba.clone(),
    }))
}

// ── Preview command ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn generate_preview_proxy(
    _state: tauri::State<'_, AppState>,
) -> Result<GeneratePreviewProxyResponse, String> {
    generate_proxy()
}

// ── GPU command ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn initialize_gpu_renderer(state: tauri::State<'_, AppState>) -> Result<GpuInitStatus, String> {
    let status = init_gpu()?;

    let mut gpu_renderer = state
        .gpu_renderer
        .lock()
        .map_err(|_| "failed to lock gpu renderer state".to_string())?;

    gpu_renderer.initialized = status.initialized;
    gpu_renderer.adapter_name = status.adapter_name.clone();
    gpu_renderer.backend = status.backend.clone();

    Ok(status)
}

// ── Display command ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDisplaysRequest {
    pub include_previews: Option<bool>,
}

/// Max width for display preview thumbnails — keeps PNG encode fast.
const PREVIEW_THUMB_WIDTH: u32 = 480;

#[tauri::command]
pub async fn list_displays(
    request: Option<ListDisplaysRequest>,
) -> Result<Vec<DisplayDescriptor>, String> {
    let include_previews = request
        .and_then(|payload| payload.include_previews)
        .unwrap_or(false);

    // Run all blocking work (screen enumeration + capture + PNG encode) on a
    // dedicated OS thread so the Tauri IPC thread stays responsive and the
    // WebView compositor is not stalled during capture.
    tauri::async_runtime::spawn_blocking(move || {
        let screens =
            Screen::all().map_err(|err| format!("failed to enumerate displays: {err}"))?;
        let preview_dir = std::env::temp_dir()
            .join("smoothshot")
            .join("display-previews");
        if include_previews {
            let _ = std::fs::create_dir_all(&preview_dir);
        }

        Ok(screens
            .iter()
            .enumerate()
            .map(|(index, screen)| {
                let preview_path = if include_previews {
                    screen.capture().ok().and_then(|full| {
                        // Downscale to thumbnail — dramatically reduces PNG encode time.
                        let thumb = image::imageops::thumbnail(
                            &full,
                            PREVIEW_THUMB_WIDTH,
                            PREVIEW_THUMB_WIDTH * full.height() / full.width().max(1),
                        );
                        let path = preview_dir.join(format!(
                            "display-{}-{}x{}-{}.png",
                            screen.display_info.id,
                            screen.display_info.width,
                            screen.display_info.height,
                            index
                        ));
                        if image::DynamicImage::ImageRgba8(thumb).save(&path).is_ok() {
                            Some(path.to_string_lossy().to_string())
                        } else {
                            None
                        }
                    })
                } else {
                    None
                };

                DisplayDescriptor {
                    index,
                    id: screen.display_info.id,
                    name: format!("Display {}", index + 1),
                    x: screen.display_info.x,
                    y: screen.display_info.y,
                    width: screen.display_info.width,
                    height: screen.display_info.height,
                    is_primary: screen.display_info.is_primary,
                    scale_factor: screen.display_info.scale_factor,
                    frequency: screen.display_info.frequency,
                    preview_path,
                }
            })
            .collect())
    })
    .await
    .map_err(|e| format!("capture thread panicked: {e}"))?
}

#[tauri::command]
pub fn list_camera_devices() -> Result<Vec<String>, String> {
    Ok(list_dshow_video_devices())
}


#[tauri::command]
pub fn list_microphone_devices() -> Result<Vec<String>, String> {
    Ok(list_input_mic_devices())
}

// ── Zoom preview command ──────────────────────────────────────────────────────

#[tauri::command]
pub fn build_zoom_preview(
    state: tauri::State<'_, AppState>,
    request: Option<ZoomPreviewRequest>,
) -> Result<ZoomPreviewResponse, String> {
    let recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    if recorder.is_recording {
        return Err("stop recording before generating zoom preview".to_string());
    }

    let request = request.unwrap_or(ZoomPreviewRequest {
        limit: None,
        zoom_in_ms: None,
        hold_ms: None,
        zoom_out_ms: None,
        max_zoom: None,
    });

    let profile = crate::timeline::zoom_track::ZoomProfile {
        zoom_in_ms: request.zoom_in_ms.unwrap_or(180),
        hold_ms: request.hold_ms.unwrap_or(120),
        zoom_out_ms: request.zoom_out_ms.unwrap_or(260),
        max_zoom: request.max_zoom.unwrap_or(1.85).clamp(1.05, 3.0),
        easing: "ease-in-out-sine".to_string(),
    };

    let frames = recorder
        .raw_frames
        .lock()
        .map_err(|_| "failed to lock frame buffer".to_string())?;
    let clicks_guard = recorder
        .click_events
        .lock()
        .map_err(|_| "failed to lock click events".to_string())?;

    let frame_metadata = build_frame_metadata(
        &frames,
        &clicks_guard,
        recorder.target_fps,
        request.limit.unwrap_or(600),
    );

    if frame_metadata.is_empty() {
        return Err("no captured frames available for preview".to_string());
    }

    let click_events = clicks_guard.clone();
    drop(clicks_guard);
    drop(frames);

    let mut transforms = Vec::with_capacity(frame_metadata.len());

    for frame in &frame_metadata {
        let mut best_zoom = 1.0_f32;
        let mut focus_x = frame.cursor_x;
        let mut focus_y = frame.cursor_y;
        let mut click_driven = false;

        for click in &click_events {
            if let Some(zoom) = zoom_from_click(frame.timestamp_ms, click.timestamp_ms, &profile) {
                if zoom > best_zoom {
                    best_zoom = zoom;
                    focus_x = click.cursor_x;
                    focus_y = click.cursor_y;
                    click_driven = true;
                }
            }
        }

        transforms.push(ZoomTransformFrame {
            frame_index: frame.frame_index,
            timestamp_ms: frame.timestamp_ms,
            zoom: (best_zoom * 1000.0).round() / 1000.0,
            focus_x,
            focus_y,
            click_driven,
        });
    }

    Ok(ZoomPreviewResponse {
        frames: transforms,
        click_count: click_events.len(),
        profile,
    })
}

// ── Export command ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn export_recording_cmd(
    state: tauri::State<'_, AppState>,
    request: Option<ExportRecordingRequest>,
) -> Result<ExportRecordingResponse, String> {
    let recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    if recorder.is_recording {
        return Err("stop recording before export".to_string());
    }

    let request = request.unwrap_or(ExportRecordingRequest {
        output_path: None,
        max_zoom: None,
        zoom_in_ms: None,
        hold_ms: None,
        zoom_out_ms: None,
        trim_start_ms: None,
        trim_end_ms: None,
        target_width: None,
        target_height: None,
        padding: None,
        background_color: None,
    });

    let source_video_path = recorder
        .source_video_path
        .clone()
        .ok_or_else(|| "missing source video path".to_string())?;

    let click_events = recorder
        .click_events
        .lock()
        .map_err(|_| "failed to lock click events".to_string())?
        .clone();

    let session_capture = recorder
        .session_capture
        .clone()
        .ok_or_else(|| "missing session capture metadata".to_string())?;

    export_recording(
        &source_video_path,
        &click_events,
        &session_capture,
        recorder.target_fps,
        recorder.last_session_duration_ms,
        &request,
    )
}

// ── Audio commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_audio_status(state: tauri::State<'_, AppState>) -> Result<AudioStatus, String> {
    let config = state
        .audio_config
        .lock()
        .map_err(|_| "failed to lock audio config".to_string())?;

    Ok(AudioStatus::from_config(&config))
}

#[tauri::command]
pub fn set_audio_config(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    config: AudioConfig,
) -> Result<AudioStatus, String> {
    let mut audio = state
        .audio_config
        .lock()
        .map_err(|_| "failed to lock audio config".to_string())?;

    let mic_was_enabled = audio.mic_enabled;
    *audio = config.clone();

    if config.mic_enabled && !mic_was_enabled {
        let mut meter_stop = state.mic_meter_stop.lock().unwrap();
        let mut meter_handle = state.mic_meter_handle.lock().unwrap();

        if let Some(stop) = meter_stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        if let Some(handle) = meter_handle.take() {
            let _ = handle.join();
        }

        let stop_signal = Arc::new(AtomicBool::new(false));
        *meter_stop = Some(Arc::clone(&stop_signal));
        *meter_handle = crate::capture::start_mic_level_emitter(app_handle, stop_signal);
    } else if !config.mic_enabled && mic_was_enabled {
        let mut meter_stop = state.mic_meter_stop.lock().unwrap();
        let mut meter_handle = state.mic_meter_handle.lock().unwrap();

        if let Some(stop) = meter_stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        if let Some(handle) = meter_handle.take() {
            let _ = handle.join();
        }
    }

    Ok(AudioStatus::from_config(&audio))
}

// ── Countdown overlay commands ────────────────────────────────────────────────

/// Show the countdown window centered on the given display area.
/// Coordinates are in virtual-desktop physical pixels (same space as DisplayDescriptor).
#[tauri::command]
pub async fn show_countdown_on_display(
    app_handle: tauri::AppHandle,
    display_x: i32,
    display_y: i32,
    display_width: u32,
    display_height: u32,
) -> Result<(), String> {
    use tauri::Manager;
    let Some(window) = app_handle.get_webview_window("countdown") else {
        return Err("countdown window not found".to_string());
    };

    // Window is 240×240 logical px; approximate center without needing scale factor.
    let center_x = display_x + (display_width as i32 / 2) - 120;
    let center_y = display_y + (display_height as i32 / 2) - 120;
    window
        .set_position(tauri::PhysicalPosition::new(center_x, center_y))
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Hide the countdown overlay window.
#[tauri::command]
pub async fn hide_countdown(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("countdown") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Window exclusion command ──────────────────────────────────────────────────

/// Mark a window so it is excluded from all screen-capture APIs.
/// Called from the frontend after dynamically created windows (e.g. display-picker) open.
#[tauri::command]
pub fn mark_window_excluded(
    app_handle: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window(&label) {
        crate::platform::exclude_window_from_capture(&window);
        Ok(())
    } else {
        Err(format!("window '{label}' not found"))
    }
}
