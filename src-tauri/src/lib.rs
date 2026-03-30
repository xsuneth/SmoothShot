use device_query::{DeviceQuery, DeviceState};
use pollster::block_on;
use screenshots::Screen;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureRegion {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartRecordingRequest {
    fps: Option<u32>,
    region: Option<CaptureRegion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameMetadata {
    frame_index: u64,
    timestamp_ms: u128,
    width: u32,
    height: u32,
    raw_bytes: usize,
    cursor_x: i32,
    cursor_y: i32,
    click_in_frame: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClickEvent {
    timestamp_ms: u128,
    cursor_x: i32,
    cursor_y: i32,
    button: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ZoomTransformFrame {
    frame_index: u64,
    timestamp_ms: u128,
    zoom: f32,
    focus_x: i32,
    focus_y: i32,
    click_driven: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ZoomProfile {
    zoom_in_ms: u128,
    hold_ms: u128,
    zoom_out_ms: u128,
    max_zoom: f32,
    easing: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ZoomPreviewResponse {
    frames: Vec<ZoomTransformFrame>,
    click_count: usize,
    profile: ZoomProfile,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ZoomPreviewRequest {
    limit: Option<usize>,
    zoom_in_ms: Option<u128>,
    hold_ms: Option<u128>,
    zoom_out_ms: Option<u128>,
    max_zoom: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GpuInitStatus {
    initialized: bool,
    adapter_name: Option<String>,
    backend: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingStatus {
    is_recording: bool,
    target_fps: u32,
    frames_captured: usize,
    clicks_detected: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StopRecordingResponse {
    target_fps: u32,
    duration_ms: u128,
    frames_captured: usize,
    clicks_detected: usize,
}

#[derive(Debug)]
struct RawFrame {
    timestamp_ms: u128,
    width: u32,
    height: u32,
    cursor_x: i32,
    cursor_y: i32,
    pixels_rgba: Vec<u8>,
}

#[derive(Debug, Default)]
struct GpuRendererState {
    initialized: bool,
    adapter_name: Option<String>,
    backend: Option<String>,
}

#[derive(Debug, Default)]
struct RecorderInner {
    is_recording: bool,
    target_fps: u32,
    started_at: Option<Instant>,
    stop_signal: Option<Arc<AtomicBool>>,
    handle: Option<JoinHandle<()>>,
    raw_frames: Arc<Mutex<Vec<RawFrame>>>,
    click_events: Arc<Mutex<Vec<ClickEvent>>>,
}

#[derive(Default)]
struct AppState {
    recorder: Mutex<RecorderInner>,
    gpu_renderer: Mutex<GpuRendererState>,
}

fn backend_name(backend: wgpu::Backend) -> String {
    match backend {
        wgpu::Backend::Vulkan => "vulkan".to_string(),
        wgpu::Backend::Metal => "metal".to_string(),
        wgpu::Backend::Dx12 => "dx12".to_string(),
        wgpu::Backend::Gl => "opengl".to_string(),
        wgpu::Backend::BrowserWebGpu => "webgpu".to_string(),
        wgpu::Backend::Noop => "noop".to_string(),
    }
}

fn ease_in_out_sine(progress: f32) -> f32 {
    -((std::f32::consts::PI * progress).cos() - 1.0) / 2.0
}

fn zoom_from_click(
    frame_timestamp_ms: u128,
    click_timestamp_ms: u128,
    profile: &ZoomProfile,
) -> Option<f32> {
    let zoom_in_end = click_timestamp_ms + profile.zoom_in_ms;
    let hold_end = zoom_in_end + profile.hold_ms;
    let zoom_out_end = hold_end + profile.zoom_out_ms;

    if frame_timestamp_ms < click_timestamp_ms || frame_timestamp_ms > zoom_out_end {
        return None;
    }

    let min_zoom = 1.0_f32;
    let zoom_span = profile.max_zoom - min_zoom;

    if frame_timestamp_ms <= zoom_in_end {
        let in_progress =
            (frame_timestamp_ms - click_timestamp_ms) as f32 / profile.zoom_in_ms.max(1) as f32;
        return Some(min_zoom + zoom_span * ease_in_out_sine(in_progress.clamp(0.0, 1.0)));
    }

    if frame_timestamp_ms <= hold_end {
        return Some(profile.max_zoom);
    }

    let out_progress =
        (frame_timestamp_ms - hold_end) as f32 / profile.zoom_out_ms.max(1) as f32;
    Some(profile.max_zoom - zoom_span * ease_in_out_sine(out_progress.clamp(0.0, 1.0)))
}

fn build_frame_metadata(
    recorder: &RecorderInner,
    limit: usize,
) -> Result<Vec<FrameMetadata>, String> {
    let frames = recorder
        .raw_frames
        .lock()
        .map_err(|_| "failed to lock frame buffer".to_string())?;

    let clicks = recorder
        .click_events
        .lock()
        .map_err(|_| "failed to lock click events".to_string())?;

    let max_items = limit.clamp(1, 5_000);
    let start_index = frames.len().saturating_sub(max_items);
    let selected = &frames[start_index..];

    let mut click_cursor = 0usize;
    let mut items = Vec::with_capacity(selected.len());
    let frame_gap_fallback = (1000_u128 / recorder.target_fps.max(1) as u128).max(1);

    for (index, frame) in selected.iter().enumerate() {
        let next_timestamp = selected
            .get(index + 1)
            .map(|next| next.timestamp_ms)
            .unwrap_or(frame.timestamp_ms + frame_gap_fallback);

        while click_cursor < clicks.len() && clicks[click_cursor].timestamp_ms < frame.timestamp_ms {
            click_cursor += 1;
        }

        let click_in_frame = clicks
            .get(click_cursor)
            .map(|click| click.timestamp_ms >= frame.timestamp_ms && click.timestamp_ms < next_timestamp)
            .unwrap_or(false);

        items.push(FrameMetadata {
            frame_index: (start_index + index) as u64,
            timestamp_ms: frame.timestamp_ms,
            width: frame.width,
            height: frame.height,
            raw_bytes: frame.pixels_rgba.len(),
            cursor_x: frame.cursor_x,
            cursor_y: frame.cursor_y,
            click_in_frame,
        });
    }

    Ok(items)
}

fn button_name(index: usize) -> String {
    match index {
        1 => "left".to_string(),
        2 => "right".to_string(),
        3 => "middle".to_string(),
        other => format!("button-{other}"),
    }
}

fn capture_loop(
    target_fps: u32,
    region: Option<CaptureRegion>,
    stop_signal: Arc<AtomicBool>,
    started_at: Instant,
    raw_frames: Arc<Mutex<Vec<RawFrame>>>,
    click_events: Arc<Mutex<Vec<ClickEvent>>>,
) {
    let screens = match Screen::all() {
        Ok(all) => all,
        Err(_) => return,
    };

    let Some(primary_screen) = screens.first() else {
        return;
    };

    let device_state = DeviceState::new();
    let mut frame_index: u64 = 0;
    let mut previous_buttons = vec![false; 8];
    let target_frame_time = Duration::from_secs_f64(1.0 / target_fps as f64);

    while !stop_signal.load(Ordering::Relaxed) {
        let frame_started = Instant::now();
        let mouse = device_state.get_mouse();

        let capture_result = if let Some(active_region) = &region {
            primary_screen.capture_area(
                active_region.x,
                active_region.y,
                active_region.width,
                active_region.height,
            )
        } else {
            primary_screen.capture()
        };

        if let Ok(image) = capture_result {
            let timestamp_ms = started_at.elapsed().as_millis();
            let current_buttons = mouse.button_pressed;
            let mut click_in_frame = false;

            for (index, pressed_now) in current_buttons.iter().enumerate() {
                let pressed_before = previous_buttons.get(index).copied().unwrap_or(false);
                if *pressed_now && !pressed_before {
                    click_in_frame = true;
                    if let Ok(mut events_guard) = click_events.lock() {
                        events_guard.push(ClickEvent {
                            timestamp_ms,
                            cursor_x: mouse.coords.0,
                            cursor_y: mouse.coords.1,
                            button: button_name(index + 1),
                        });
                    }
                }
            }

            previous_buttons = current_buttons;

            if let Ok(mut frames_guard) = raw_frames.lock() {
                frames_guard.push(RawFrame {
                    timestamp_ms,
                    width: image.width(),
                    height: image.height(),
                    cursor_x: mouse.coords.0,
                    cursor_y: mouse.coords.1,
                    pixels_rgba: image.into_raw(),
                });
            }

            let _ = click_in_frame;
            frame_index = frame_index.saturating_add(1);
        }

        let elapsed = frame_started.elapsed();
        if elapsed < target_frame_time {
            thread::sleep(target_frame_time - elapsed);
        }
    }

    let _ = frame_index;
}

#[tauri::command]
fn start_recording(
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

    let target_fps = request
        .as_ref()
        .and_then(|value| value.fps)
        .unwrap_or(60)
        .clamp(24, 60);

    let region = request.and_then(|value| value.region);
    let stop_signal = Arc::new(AtomicBool::new(false));
    let started_at = Instant::now();
    let raw_frames = Arc::new(Mutex::new(Vec::new()));
    let click_events = Arc::new(Mutex::new(Vec::new()));

    let thread_stop = Arc::clone(&stop_signal);
    let thread_frames = Arc::clone(&raw_frames);
    let thread_clicks = Arc::clone(&click_events);
    let handle = thread::spawn(move || {
        capture_loop(
            target_fps,
            region,
            thread_stop,
            started_at,
            thread_frames,
            thread_clicks,
        )
    });

    recorder.is_recording = true;
    recorder.target_fps = target_fps;
    recorder.started_at = Some(started_at);
    recorder.stop_signal = Some(stop_signal);
    recorder.handle = Some(handle);
    recorder.raw_frames = raw_frames;
    recorder.click_events = click_events;

    Ok(RecordingStatus {
        is_recording: true,
        target_fps,
        frames_captured: 0,
        clicks_detected: 0,
    })
}

#[tauri::command]
fn stop_recording(state: tauri::State<'_, AppState>) -> Result<StopRecordingResponse, String> {
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

    Ok(StopRecordingResponse {
        target_fps: recorder.target_fps,
        duration_ms,
        frames_captured,
        clicks_detected,
    })
}

#[tauri::command]
fn get_recording_status(state: tauri::State<'_, AppState>) -> Result<RecordingStatus, String> {
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
fn get_click_timeline(state: tauri::State<'_, AppState>) -> Result<Vec<ClickEvent>, String> {
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
fn get_frame_timeline(
    state: tauri::State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<FrameMetadata>, String> {
    let recorder = state
        .recorder
        .lock()
        .map_err(|_| "failed to lock recorder state".to_string())?;

    build_frame_metadata(&recorder, limit.unwrap_or(300))
}

#[tauri::command]
fn initialize_gpu_renderer(state: tauri::State<'_, AppState>) -> Result<GpuInitStatus, String> {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());

    let adapter = block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
    }))
    .map_err(|err| format!("failed to find GPU adapter: {err}"))?;

    let info = adapter.get_info();
    let mut gpu_renderer = state
        .gpu_renderer
        .lock()
        .map_err(|_| "failed to lock gpu renderer state".to_string())?;

    gpu_renderer.initialized = true;
    gpu_renderer.adapter_name = Some(info.name.clone());
    gpu_renderer.backend = Some(backend_name(info.backend));

    Ok(GpuInitStatus {
        initialized: gpu_renderer.initialized,
        adapter_name: gpu_renderer.adapter_name.clone(),
        backend: gpu_renderer.backend.clone(),
    })
}

#[tauri::command]
fn build_zoom_preview(
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

    let profile = ZoomProfile {
        zoom_in_ms: request.zoom_in_ms.unwrap_or(180),
        hold_ms: request.hold_ms.unwrap_or(120),
        zoom_out_ms: request.zoom_out_ms.unwrap_or(260),
        max_zoom: request.max_zoom.unwrap_or(1.85).clamp(1.05, 3.0),
        easing: "ease-in-out-sine".to_string(),
    };

    let frame_metadata = build_frame_metadata(&recorder, request.limit.unwrap_or(600))?;
    if frame_metadata.is_empty() {
        return Err("no captured frames available for preview".to_string());
    }

    let click_events = recorder
        .click_events
        .lock()
        .map_err(|_| "failed to lock click events".to_string())?
        .clone();

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

#[tauri::command]
fn export_recording() -> Result<String, String> {
    Err("Export pipeline is scheduled for v0.3.0 (FFmpeg integration).".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            get_recording_status,
            get_click_timeline,
            get_frame_timeline,
            initialize_gpu_renderer,
            build_zoom_preview,
            export_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
