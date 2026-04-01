mod app;
mod project;
mod render;

use app::state::{
    AppState, CaptureRegion, ClickEvent, DisplayDescriptor, ExportFrameSample,
    ExportRecordingRequest, ExportRecordingResponse, FrameMetadata, RawFrame, RecorderInner,
    RecordingStatus, SessionCaptureConfig, StartRecordingRequest, StopRecordingResponse,
    ZoomPreviewRequest, ZoomPreviewResponse, ZoomProfile, ZoomTransformFrame,
};
use render::compositor::{backend_name, GpuInitStatus};

use device_query::{DeviceQuery, DeviceState};
use pollster::block_on;
use screenshots::Screen;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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

fn compute_zoom_window(
    width: u32,
    height: u32,
    zoom: f32,
    focus_x: i32,
    focus_y: i32,
) -> (u32, u32, u32, u32) {
    let crop_w = ((width as f32) / zoom).round().max(1.0) as u32;
    let crop_h = ((height as f32) / zoom).round().max(1.0) as u32;

    let max_x0 = width.saturating_sub(crop_w) as i32;
    let max_y0 = height.saturating_sub(crop_h) as i32;
    let x0 = (focus_x - (crop_w as i32 / 2)).clamp(0, max_x0) as u32;
    let y0 = (focus_y - (crop_h as i32 / 2)).clamp(0, max_y0) as u32;

    (crop_w, crop_h, x0, y0)
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
    let (crop_w, crop_h, x0, y0) = compute_zoom_window(width, height, zoom, focus_x, focus_y);

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

fn map_point_through_zoom(
    width: u32,
    height: u32,
    zoom: f32,
    focus_x: i32,
    focus_y: i32,
    point_x: i32,
    point_y: i32,
) -> (i32, i32) {
    if zoom <= 1.001 {
        return (
            point_x.clamp(0, width.saturating_sub(1) as i32),
            point_y.clamp(0, height.saturating_sub(1) as i32),
        );
    }

    let (crop_w, crop_h, x0, y0) = compute_zoom_window(width, height, zoom, focus_x, focus_y);

    let local_x = (point_x - x0 as i32).clamp(0, crop_w.saturating_sub(1) as i32);
    let local_y = (point_y - y0 as i32).clamp(0, crop_h.saturating_sub(1) as i32);

    let mapped_x = ((local_x as f32 / crop_w.max(1) as f32) * width as f32).round() as i32;
    let mapped_y = ((local_y as f32 / crop_h.max(1) as f32) * height as f32).round() as i32;

    (
        mapped_x.clamp(0, width.saturating_sub(1) as i32),
        mapped_y.clamp(0, height.saturating_sub(1) as i32),
    )
}

fn blend_pixel_rgba(dst: &mut [u8], offset: usize, color: [u8; 4]) {
    let alpha = color[3] as f32 / 255.0;
    let inv = 1.0 - alpha;
    dst[offset] = (dst[offset] as f32 * inv + color[0] as f32 * alpha) as u8;
    dst[offset + 1] = (dst[offset + 1] as f32 * inv + color[1] as f32 * alpha) as u8;
    dst[offset + 2] = (dst[offset + 2] as f32 * inv + color[2] as f32 * alpha) as u8;
    dst[offset + 3] = 255;
}

fn draw_ring_rgba(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    center_x: i32,
    center_y: i32,
    radius: i32,
    thickness: i32,
    color: [u8; 4],
) {
    let width_i32 = width as i32;
    let height_i32 = height as i32;
    let min_x = (center_x - radius - thickness).clamp(0, width_i32.saturating_sub(1));
    let max_x = (center_x + radius + thickness).clamp(0, width_i32.saturating_sub(1));
    let min_y = (center_y - radius - thickness).clamp(0, height_i32.saturating_sub(1));
    let max_y = (center_y + radius + thickness).clamp(0, height_i32.saturating_sub(1));

    let inner = (radius - thickness).max(0);
    let outer = radius + thickness;
    let inner_sq = inner * inner;
    let outer_sq = outer * outer;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let dx = x - center_x;
            let dy = y - center_y;
            let dist_sq = dx * dx + dy * dy;
            if dist_sq >= inner_sq && dist_sq <= outer_sq {
                let offset = ((y as usize * width as usize) + x as usize) * 4;
                blend_pixel_rgba(pixels, offset, color);
            }
        }
    }
}

fn draw_filled_circle_rgba(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    center_x: i32,
    center_y: i32,
    radius: i32,
    color: [u8; 4],
) {
    let width_i32 = width as i32;
    let height_i32 = height as i32;
    let min_x = (center_x - radius).clamp(0, width_i32.saturating_sub(1));
    let max_x = (center_x + radius).clamp(0, width_i32.saturating_sub(1));
    let min_y = (center_y - radius).clamp(0, height_i32.saturating_sub(1));
    let max_y = (center_y + radius).clamp(0, height_i32.saturating_sub(1));
    let radius_sq = radius * radius;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let dx = x - center_x;
            let dy = y - center_y;
            if dx * dx + dy * dy <= radius_sq {
                let offset = ((y as usize * width as usize) + x as usize) * 4;
                blend_pixel_rgba(pixels, offset, color);
            }
        }
    }
}

fn draw_cursor_overlay_rgba(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    cursor_x: i32,
    cursor_y: i32,
    timestamp_ms: u128,
    click_events_local: &[(u128, i32, i32)],
) {
    draw_filled_circle_rgba(
        pixels,
        width,
        height,
        cursor_x,
        cursor_y,
        6,
        [36, 206, 229, 255],
    );
    draw_ring_rgba(
        pixels,
        width,
        height,
        cursor_x,
        cursor_y,
        9,
        2,
        [255, 255, 255, 220],
    );

    for (click_time, click_x, click_y) in click_events_local {
        if timestamp_ms < *click_time || timestamp_ms > (*click_time + 340) {
            continue;
        }

        let progress = (timestamp_ms - *click_time) as f32 / 340.0;
        let radius = (12.0 + (20.0 * progress)).round() as i32;
        let alpha = (220.0 * (1.0 - progress)).round().clamp(0.0, 255.0) as u8;
        draw_ring_rgba(
            pixels,
            width,
            height,
            *click_x,
            *click_y,
            radius,
            2,
            [255, 202, 51, alpha],
        );
    }
}

fn build_export_frame_samples(
    frames: &[RawFrame],
    target_fps: u32,
    total_duration_ms: u128,
) -> Vec<ExportFrameSample> {
    if frames.is_empty() {
        return Vec::new();
    }

    let interval_ms = 1000.0_f64 / target_fps.max(1) as f64;
    let last_frame_timestamp_ms = frames
        .last()
        .map(|frame| frame.timestamp_ms as f64)
        .unwrap_or_default();
    let effective_duration_ms = total_duration_ms.max(last_frame_timestamp_ms as u128) as f64;
    let output_len = ((effective_duration_ms / interval_ms).floor() as usize).saturating_add(1);

    let mut samples = Vec::with_capacity(output_len.max(frames.len()));
    let mut source_idx = 0usize;

    for output_idx in 0..output_len {
        let output_timestamp_ms = output_idx as f64 * interval_ms;
        while source_idx + 1 < frames.len()
            && (frames[source_idx + 1].timestamp_ms as f64) <= output_timestamp_ms
        {
            source_idx += 1;
        }

        let right_idx = (source_idx + 1).min(frames.len() - 1);
        let left_ts = frames[source_idx].timestamp_ms as f64;
        let right_ts = frames[right_idx].timestamp_ms as f64;
        let blend = if right_idx == source_idx || (right_ts - left_ts).abs() < f64::EPSILON {
            0.0
        } else {
            ((output_timestamp_ms - left_ts) / (right_ts - left_ts)).clamp(0.0, 1.0) as f32
        };

        samples.push(ExportFrameSample {
            left_index: source_idx,
            right_index: right_idx,
            blend,
            timestamp_ms: output_timestamp_ms.round() as u128,
        });
    }

    if samples.is_empty() {
        samples.push(ExportFrameSample {
            left_index: frames.len() - 1,
            right_index: frames.len() - 1,
            blend: 0.0,
            timestamp_ms: 0,
        });
    }

    samples
}

fn blend_frames_rgba(left: &[u8], right: &[u8], blend: f32) -> Vec<u8> {
    if blend <= 0.001 {
        return left.to_vec();
    }

    if blend >= 0.999 {
        return right.to_vec();
    }

    let inv = 1.0 - blend;
    let mut out = vec![0_u8; left.len()];
    for i in 0..left.len() {
        out[i] = (left[i] as f32 * inv + right[i] as f32 * blend).round() as u8;
    }
    out
}

fn global_to_frame_coords(
    global_x: i32,
    global_y: i32,
    session_capture: &SessionCaptureConfig,
) -> (i32, i32) {
    if let Some(region) = &session_capture.region {
        (global_x - region.x, global_y - region.y)
    } else {
        (
            global_x - session_capture.display_origin_x,
            global_y - session_capture.display_origin_y,
        )
    }
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
    capture_screen: Screen,
    stop_signal: Arc<AtomicBool>,
    started_at: Instant,
    raw_frames: Arc<Mutex<Vec<RawFrame>>>,
    click_events: Arc<Mutex<Vec<ClickEvent>>>,
) {
    let device_state = DeviceState::new();

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
    let region = request.region.clone();
    let display_index = request.display_index;
    let screens = Screen::all().map_err(|err| format!("failed to enumerate displays: {err}"))?;
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
            capture_screen,
            thread_stop,
            started_at,
            thread_frames,
            thread_clicks,
        )
    });

    recorder.is_recording = true;
    recorder.target_fps = target_fps;
    recorder.started_at = Some(started_at);
    recorder.last_session_duration_ms = 0;
    recorder.session_capture = Some(SessionCaptureConfig {
        display_origin_x: capture_screen.display_info.x,
        display_origin_y: capture_screen.display_info.y,
        region: request.region,
    });
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
    recorder.last_session_duration_ms = duration_ms;

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
    let session_duration_ms = recorder.last_session_duration_ms;
    let export_frame_samples = build_export_frame_samples(&frames_guard, fps, session_duration_ms);
    let session_capture = recorder
        .session_capture
        .clone()
        .ok_or_else(|| "missing session capture metadata".to_string())?;

    let click_events_local: Vec<(u128, i32, i32)> = click_events
        .iter()
        .map(|click| {
            let (local_x, local_y) =
                global_to_frame_coords(click.cursor_x, click.cursor_y, &session_capture);
            (click.timestamp_ms, local_x, local_y)
        })
        .collect();

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

    for sample in &export_frame_samples {
        let left_frame = &frames_guard[sample.left_index];
        let right_frame = &frames_guard[sample.right_index];

        let blended_cursor_x = (left_frame.cursor_x as f32 * (1.0 - sample.blend)
            + right_frame.cursor_x as f32 * sample.blend)
            .round() as i32;
        let blended_cursor_y = (left_frame.cursor_y as f32 * (1.0 - sample.blend)
            + right_frame.cursor_y as f32 * sample.blend)
            .round() as i32;

        let source_pixels = blend_frames_rgba(&left_frame.pixels_rgba, &right_frame.pixels_rgba, sample.blend);

        let (zoom, focus_x_global, focus_y_global) = best_zoom_and_focus(
            sample.timestamp_ms,
            blended_cursor_x,
            blended_cursor_y,
            &click_events,
            &profile,
        );

        let (focus_x_local, focus_y_local) =
            global_to_frame_coords(focus_x_global, focus_y_global, &session_capture);
        let (cursor_x_local, cursor_y_local) =
            global_to_frame_coords(blended_cursor_x, blended_cursor_y, &session_capture);

        let mut transformed = apply_zoom_transform_rgba(
            &source_pixels,
            left_frame.width,
            left_frame.height,
            zoom,
            focus_x_local,
            focus_y_local,
        );

        let (cursor_mapped_x, cursor_mapped_y) = map_point_through_zoom(
            left_frame.width,
            left_frame.height,
            zoom,
            focus_x_local,
            focus_y_local,
            cursor_x_local,
            cursor_y_local,
        );

        let mapped_clicks: Vec<(u128, i32, i32)> = click_events_local
            .iter()
            .map(|(time, x, y)| {
                let (mx, my) = map_point_through_zoom(
                    left_frame.width,
                    left_frame.height,
                    zoom,
                    focus_x_local,
                    focus_y_local,
                    *x,
                    *y,
                );
                (*time, mx, my)
            })
            .collect();

        draw_cursor_overlay_rgba(
            &mut transformed,
            left_frame.width,
            left_frame.height,
            cursor_mapped_x,
            cursor_mapped_y,
            sample.timestamp_ms,
            &mapped_clicks,
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
        frames_exported: export_frame_samples.len(),
        width: 1920,
        height: 1080,
        target_fps: fps,
        output_duration_ms: ((export_frame_samples.len().saturating_sub(1) as u128) * 1000)
            / fps as u128,
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
