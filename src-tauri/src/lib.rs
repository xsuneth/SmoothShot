use device_query::{DeviceQuery, DeviceState};
use pollster::block_on;
use screenshots::Screen;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{SystemTime, UNIX_EPOCH};
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
    display_index: Option<usize>,
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
struct DisplayDescriptor {
    index: usize,
    id: u32,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    is_primary: bool,
    scale_factor: f32,
    frequency: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRecordingRequest {
    output_path: Option<String>,
    max_zoom: Option<f32>,
    zoom_in_ms: Option<u128>,
    hold_ms: Option<u128>,
    zoom_out_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportRecordingResponse {
    output_path: String,
    frames_exported: usize,
    width: u32,
    height: u32,
    target_fps: u32,
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

fn best_zoom_and_focus(
    frame_timestamp_ms: u128,
    fallback_x: i32,
    fallback_y: i32,
    click_events: &[ClickEvent],
    profile: &ZoomProfile,
) -> (f32, i32, i32) {
    let mut best_zoom = 1.0_f32;
    let mut focus_x = fallback_x;
    let mut focus_y = fallback_y;

    for click in click_events {
        if let Some(zoom) = zoom_from_click(frame_timestamp_ms, click.timestamp_ms, profile) {
            if zoom > best_zoom {
                best_zoom = zoom;
                focus_x = click.cursor_x;
                focus_y = click.cursor_y;
            }
        }
    }

    (best_zoom, focus_x, focus_y)
}

fn apply_zoom_transform_rgba(
    source: &[u8],
    width: u32,
    height: u32,
    zoom: f32,
    focus_x: i32,
    focus_y: i32,
) -> Vec<u8> {
    if zoom <= 1.001 {
        return source.to_vec();
    }

    let width_usize = width as usize;
    let height_usize = height as usize;
    let crop_w = ((width as f32) / zoom).round().max(1.0) as u32;
    let crop_h = ((height as f32) / zoom).round().max(1.0) as u32;

    let max_x0 = width.saturating_sub(crop_w) as i32;
    let max_y0 = height.saturating_sub(crop_h) as i32;
    let x0 = (focus_x - (crop_w as i32 / 2)).clamp(0, max_x0) as u32;
    let y0 = (focus_y - (crop_h as i32 / 2)).clamp(0, max_y0) as u32;

    let mut output = vec![0_u8; source.len()];

    for y in 0..height_usize {
        for x in 0..width_usize {
            let sx = x0 + (((x as f32) / (width as f32)) * crop_w as f32).floor() as u32;
            let sy = y0 + (((y as f32) / (height as f32)) * crop_h as f32).floor() as u32;

            let sx = sx.min(width.saturating_sub(1));
            let sy = sy.min(height.saturating_sub(1));

            let src_offset = ((sy as usize * width_usize) + sx as usize) * 4;
            let dst_offset = ((y * width_usize) + x) * 4;
            output[dst_offset..dst_offset + 4].copy_from_slice(&source[src_offset..src_offset + 4]);
        }
    }

    output
}

fn build_export_frame_indices(frames: &[RawFrame], target_fps: u32) -> Vec<usize> {
    if frames.is_empty() {
        return Vec::new();
    }

    let interval_ms = 1000.0_f64 / target_fps.max(1) as f64;
    let last_timestamp_ms = frames
        .last()
        .map(|frame| frame.timestamp_ms as f64)
        .unwrap_or_default();
    let output_len = ((last_timestamp_ms / interval_ms).floor() as usize).saturating_add(1);

    let mut indices = Vec::with_capacity(output_len.max(frames.len()));
    let mut source_idx = 0usize;

    for output_idx in 0..output_len {
        let output_timestamp_ms = output_idx as f64 * interval_ms;
        while source_idx + 1 < frames.len()
            && (frames[source_idx + 1].timestamp_ms as f64) <= output_timestamp_ms
        {
            source_idx += 1;
        }
        indices.push(source_idx);
    }

    if indices.is_empty() {
        indices.push(frames.len() - 1);
    }

    indices
}

fn button_name(index: usize) -> String {
    match index {
        1 => "left".to_string(),
        2 => "right".to_string(),
        3 => "middle".to_string(),
        other => format!("button-{other}"),
    }
}

fn resolve_capture_screen(
    screens: &[Screen],
    display_index: Option<usize>,
    fallback_x: i32,
    fallback_y: i32,
) -> Option<Screen> {
    if let Some(index) = display_index {
        if let Some(screen) = screens.get(index) {
            return Some(*screen);
        }
    }

    Screen::from_point(fallback_x, fallback_y)
        .ok()
        .or_else(|| screens.iter().find(|screen| screen.display_info.is_primary).copied())
        .or_else(|| screens.first().copied())
}

fn capture_loop(
    target_fps: u32,
    region: Option<CaptureRegion>,
    display_index: Option<usize>,
    stop_signal: Arc<AtomicBool>,
    started_at: Instant,
    raw_frames: Arc<Mutex<Vec<RawFrame>>>,
    click_events: Arc<Mutex<Vec<ClickEvent>>>,
) {
    let screens = match Screen::all() {
        Ok(all) => all,
        Err(_) => return,
    };

    let device_state = DeviceState::new();
    let initial_mouse = device_state.get_mouse();
    let preferred_point = region
        .as_ref()
        .map(|area| (area.x, area.y))
        .unwrap_or(initial_mouse.coords);

    let Some(capture_screen) = resolve_capture_screen(
        &screens,
        display_index,
        preferred_point.0,
        preferred_point.1,
    ) else {
        return;
    };

    let mut frame_index: u64 = 0;
    let mut previous_buttons = vec![false; 8];
    let target_frame_time = Duration::from_secs_f64(1.0 / target_fps as f64);

    while !stop_signal.load(Ordering::Relaxed) {
        let frame_started = Instant::now();
        let mouse = device_state.get_mouse();

        let capture_result = if let Some(active_region) = &region {
            let local_x = active_region.x - capture_screen.display_info.x;
            let local_y = active_region.y - capture_screen.display_info.y;
            capture_screen.capture_area(
                local_x,
                local_y,
                active_region.width,
                active_region.height,
            )
        } else {
            capture_screen.capture()
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

    let request = request.unwrap_or(StartRecordingRequest {
        fps: None,
        region: None,
        display_index: None,
    });

    let target_fps = request.fps.unwrap_or(60).clamp(24, 60);
    let region = request.region;
    let display_index = request.display_index;
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
            display_index,
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
fn list_displays() -> Result<Vec<DisplayDescriptor>, String> {
    let screens = Screen::all().map_err(|err| format!("failed to enumerate displays: {err}"))?;
    Ok(screens
        .iter()
        .enumerate()
        .map(|(index, screen)| DisplayDescriptor {
            index,
            id: screen.display_info.id,
            x: screen.display_info.x,
            y: screen.display_info.y,
            width: screen.display_info.width,
            height: screen.display_info.height,
            is_primary: screen.display_info.is_primary,
            scale_factor: screen.display_info.scale_factor,
            frequency: screen.display_info.frequency,
        })
        .collect())
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
fn export_recording(
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

    let mut check = Command::new("ffmpeg");
    check.arg("-version");
    let check_result = check
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if check_result.is_err() {
        return Err("ffmpeg was not found in PATH".to_string());
    }

    let output_path = if let Some(path) = request.output_path {
        PathBuf::from(path)
    } else {
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "failed to read system time".to_string())?
            .as_secs();
        let mut path = PathBuf::from("exports");
        path.push(format!("smoothshot-{epoch}.mp4"));
        path
    };

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("failed to create output directory: {err}"))?;
    }

    let profile = ZoomProfile {
        zoom_in_ms: request.zoom_in_ms.unwrap_or(180),
        hold_ms: request.hold_ms.unwrap_or(120),
        zoom_out_ms: request.zoom_out_ms.unwrap_or(260),
        max_zoom: request.max_zoom.unwrap_or(1.85).clamp(1.05, 3.0),
        easing: "ease-in-out-sine".to_string(),
    };

    let click_events = recorder
        .click_events
        .lock()
        .map_err(|_| "failed to lock click events".to_string())?
        .clone();

    let frames_guard = recorder
        .raw_frames
        .lock()
        .map_err(|_| "failed to lock frame buffer".to_string())?;

    if frames_guard.is_empty() {
        return Err("no captured frames available to export".to_string());
    }

    let width = frames_guard[0].width;
    let height = frames_guard[0].height;
    let fps = recorder.target_fps.max(1);
    let export_frame_indices = build_export_frame_indices(&frames_guard, fps);

    let mut child = Command::new("ffmpeg")
        .arg("-y")
        .arg("-f")
        .arg("rawvideo")
        .arg("-pixel_format")
        .arg("rgba")
        .arg("-video_size")
        .arg(format!("{width}x{height}"))
        .arg("-framerate")
        .arg(fps.to_string())
        .arg("-i")
        .arg("-")
        .arg("-vf")
        .arg("scale=1920:1080:flags=lanczos")
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-preset")
        .arg("veryfast")
        .arg("-movflags")
        .arg("+faststart")
        .arg(output_path.to_string_lossy().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start ffmpeg: {err}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to open ffmpeg stdin".to_string())?;

    for source_index in &export_frame_indices {
        let frame = &frames_guard[*source_index];
        let (zoom, focus_x, focus_y) = best_zoom_and_focus(
            frame.timestamp_ms,
            frame.cursor_x,
            frame.cursor_y,
            &click_events,
            &profile,
        );

        let transformed = apply_zoom_transform_rgba(
            &frame.pixels_rgba,
            frame.width,
            frame.height,
            zoom,
            focus_x,
            focus_y,
        );

        stdin
            .write_all(&transformed)
            .map_err(|err| format!("failed while streaming frames to ffmpeg: {err}"))?;
    }
    drop(stdin);

    let output = child
        .wait_with_output()
        .map_err(|err| format!("failed to wait for ffmpeg: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ffmpeg export failed: {stderr}"));
    }

    Ok(ExportRecordingResponse {
        output_path: output_path.to_string_lossy().to_string(),
        frames_exported: export_frame_indices.len(),
        width: 1920,
        height: 1080,
        target_fps: fps,
    })
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
            list_displays,
            get_click_timeline,
            get_frame_timeline,
            initialize_gpu_renderer,
            build_zoom_preview,
            export_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
