// Tauri command handlers
//
// All `#[tauri::command]` functions live here.  They receive the shared
// `AppState` and delegate to the appropriate subsystem modules.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use screenshots::Screen;
use serde::Deserialize;

use crate::app::state::AppState;
use crate::audio::{list_dshow_video_devices, list_input_mic_devices, AudioConfig, AudioStatus};
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
    let source_video_path = session_folder.join("source.mp4");

    let session_capture = SessionCaptureConfig {
        display_index: display_index.unwrap_or(0),
        display_origin_x: capture_screen.display_info.x,
        display_origin_y: capture_screen.display_info.y,
        region: request.region,
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
    let thread_frames = Arc::clone(&raw_frames);
    let thread_clicks = Arc::clone(&click_events);
    let thread_source_video_path = Some(source_video_path.to_string_lossy().to_string());
    let thread_session_capture = session_capture.clone();
    let handle = thread::spawn(move || {
        capture_loop(
            target_fps,
            capture_screen,
            thread_session_capture,
            thread_stop,
            started_at,
            thread_frames,
            thread_clicks,
            thread_source_video_path,
            audio_config,
        )
    });

    recorder.is_recording = true;
    recorder.target_fps = target_fps;
    recorder.started_at = Some(started_at);
    recorder.last_session_duration_ms = 0;
    recorder.session_capture = Some(session_capture);
    recorder.stop_signal = Some(stop_signal);
    recorder.handle = Some(handle);
    recorder.raw_frames = raw_frames;
    recorder.click_events = click_events;
    recorder.session_folder = Some(session_folder.to_string_lossy().to_string());
    recorder.source_video_path = Some(source_video_path.to_string_lossy().to_string());
    recorder.proxy_path = None;

    Ok(RecordingStatus {
        is_recording: true,
        target_fps,
        frames_captured: 0,
        clicks_detected: 0,
    })
}

#[tauri::command]
pub fn stop_recording(state: tauri::State<'_, AppState>) -> Result<StopRecordingResponse, String> {
    let mut recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    if !recorder.is_recording {
        return Err("no active recording session".to_string());
    }

    if let Some(signal) = recorder.stop_signal.take() {
        signal.store(true, Ordering::Relaxed);
    }

    if let Some(handle) = recorder.handle.take() {
        let _ = handle.join();
    }

    recorder.is_recording = false;

    let duration_ms = recorder
        .started_at
        .map(|start| start.elapsed().as_millis())
        .unwrap_or_default();
    recorder.last_session_duration_ms = duration_ms;

    let frames_guard = recorder
        .raw_frames
        .lock()
        .map_err(|_| "failed to lock frame buffer".to_string())?;
    let frames_captured = frames_guard.len();

    let clicks_guard = recorder
        .click_events
        .lock()
        .map_err(|_| "failed to lock click events".to_string())?;
    let clicks_detected = clicks_guard.len();

    // Determine source dimensions from the first frame (if available).
    let (source_width, source_height) = frames_guard
        .first()
        .map(|f| (f.width, f.height))
        .unwrap_or((0, 0));

    // Build per-frame cursor events for the metadata file.
    let cursor_events: Vec<CursorEventRecord> = frames_guard
        .iter()
        .map(|f| CursorEventRecord {
            timestamp_ms: f.timestamp_ms,
            x: f.cursor_x,
            y: f.cursor_y,
        })
        .collect();

    // Clone click events for persistence (we release the lock immediately
    // after to avoid holding two locks).
    let click_events_for_disk: Vec<ClickEvent> = clicks_guard.clone();
    drop(clicks_guard);
    drop(frames_guard);

    // Persist session metadata to disk.
    let session_folder = recorder
        .session_folder
        .clone()
        .ok_or_else(|| "missing session folder".to_string())?;

    let project = ProjectFile {
        version: 1,
        session_id: std::path::Path::new(&session_folder)
            .file_name()
            .and_then(|name| name.to_str())
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

    let session_folder = Some(persist_session_in_folder(
        std::path::Path::new(&session_folder),
        &project,
        &click_events_for_disk,
        &cursor_events,
    )?);

    recorder.session_folder = session_folder.clone();
    recorder.proxy_path = None;

    Ok(StopRecordingResponse {
        target_fps: recorder.target_fps,
        duration_ms,
        frames_captured,
        clicks_detected,
        session_folder,
        source_video_path: recorder.source_video_path.clone(),
        proxy_path: None,
    })
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

    Ok(RecordingStatus {
        is_recording: recorder.is_recording,
        target_fps: recorder.target_fps,
        frames_captured,
        clicks_detected,
    })
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
#[allow(unused_variables)]
pub fn generate_preview_proxy(
    state: tauri::State<'_, AppState>,
) -> Result<GeneratePreviewProxyResponse, String> {
    return Err(
        "preview proxy generation is disabled while SmoothShot uses source-video preview"
            .to_string(),
    );

    #[allow(unreachable_code)]
    let (
        raw_frames,
        click_events_store,
        session_capture,
        target_fps,
        session_duration_ms,
        session_folder,
    ) = {
        let recorder = state
            .recorder
            .lock()
            .map_err(|_| "failed to lock recorder state".to_string())?;

        if recorder.is_recording {
            return Err("stop recording before generating preview proxy".to_string());
        }

        let session_folder = recorder.session_folder.clone().ok_or_else(|| {
            "no session folder available – start and stop a recording first".to_string()
        })?;

        let session_capture = recorder
            .session_capture
            .clone()
            .ok_or_else(|| "missing session capture metadata".to_string())?;

        (
            recorder.raw_frames.clone(),
            recorder.click_events.clone(),
            session_capture,
            recorder.target_fps,
            recorder.last_session_duration_ms,
            session_folder,
        )
    };

    let frames_guard = raw_frames
        .lock()
        .map_err(|_| "failed to lock frame buffer".to_string())?;

    if frames_guard.is_empty() {
        return Err("no captured frames available for proxy generation".to_string());
    }

    let click_events = click_events_store
        .lock()
        .map_err(|_| "failed to lock click events".to_string())?
        .clone();

    let result = generate_proxy(
        &frames_guard,
        &click_events,
        &session_capture,
        target_fps,
        session_duration_ms,
        &session_folder,
    )?;

    drop(frames_guard);

    let mut recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;
    recorder.proxy_path = Some(result.proxy_path.clone());

    Ok(result)
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

#[tauri::command]
pub fn list_displays(
    request: Option<ListDisplaysRequest>,
) -> Result<Vec<DisplayDescriptor>, String> {
    let include_previews = request
        .and_then(|payload| payload.include_previews)
        .unwrap_or(false);
    let screens = Screen::all().map_err(|err| format!("failed to enumerate displays: {err}"))?;
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
                screen.capture().ok().and_then(|image| {
                    let path = preview_dir.join(format!(
                        "display-{}-{}x{}-{}.png",
                        screen.display_info.id,
                        screen.display_info.width,
                        screen.display_info.height,
                        index
                    ));
                    if image.save(&path).is_ok() {
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
    });

    let frames = recorder
        .raw_frames
        .lock()
        .map_err(|_| "failed to lock frame buffer".to_string())?;

    if frames
        .first()
        .map(|frame| frame.pixels_rgba.is_empty())
        .unwrap_or(true)
    {
        return Err(
            "export is not yet migrated to the new disk-backed source-video pipeline".to_string(),
        );
    }

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
        &frames,
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
