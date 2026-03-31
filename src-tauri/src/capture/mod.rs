use device_query::{DeviceQuery, DeviceState};
use screenshots::Screen;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

// ── Public data types ──────────────────────────────────────────────────────────

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
pub struct ClickEvent {
    pub timestamp_ms: u128,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub button: String,
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
    /// Path to the session folder written to disk (if persistence succeeded).
    pub session_folder: Option<String>,
    /// Path to the proxy MP4 (set after calling generate_preview_proxy).
    pub proxy_path: Option<String>,
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

// ── Raw frame (stored in memory during recording) ────────────────────────────

#[derive(Debug)]
pub struct RawFrame {
    pub timestamp_ms: u128,
    pub width: u32,
    pub height: u32,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub pixels_rgba: Vec<u8>,
}

// ── Capture configuration ─────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct SessionCaptureConfig {
    pub display_origin_x: i32,
    pub display_origin_y: i32,
    pub region: Option<CaptureRegion>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn button_name(index: usize) -> String {
    match index {
        1 => "left".to_string(),
        2 => "right".to_string(),
        3 => "middle".to_string(),
        other => format!("button-{other}"),
    }
}

pub fn global_to_frame_coords(
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

pub fn resolve_capture_screen(
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
        .or_else(|| {
            screens
                .iter()
                .find(|screen| screen.display_info.is_primary)
                .copied()
        })
        .or_else(|| screens.first().copied())
}

pub fn build_frame_metadata(
    frames: &[RawFrame],
    clicks: &[ClickEvent],
    target_fps: u32,
    limit: usize,
) -> Vec<FrameMetadata> {
    let max_items = limit.clamp(1, 5_000);
    let start_index = frames.len().saturating_sub(max_items);
    let selected = &frames[start_index..];

    let mut click_cursor = 0usize;
    let mut items = Vec::with_capacity(selected.len());
    let frame_gap_fallback = (1000_u128 / target_fps.max(1) as u128).max(1);

    for (index, frame) in selected.iter().enumerate() {
        let next_timestamp = selected
            .get(index + 1)
            .map(|next| next.timestamp_ms)
            .unwrap_or(frame.timestamp_ms + frame_gap_fallback);

        while click_cursor < clicks.len() && clicks[click_cursor].timestamp_ms < frame.timestamp_ms
        {
            click_cursor += 1;
        }

        let click_in_frame = clicks
            .get(click_cursor)
            .map(|click| {
                click.timestamp_ms >= frame.timestamp_ms && click.timestamp_ms < next_timestamp
            })
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

    items
}

// ── Capture loop (CPU screenshot polling backend) ─────────────────────────────

pub fn capture_loop(
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

            for (index, pressed_now) in current_buttons.iter().enumerate() {
                let pressed_before = previous_buttons.get(index).copied().unwrap_or(false);
                if *pressed_now && !pressed_before {
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

            frame_index = frame_index.saturating_add(1);
        }

        let elapsed = frame_started.elapsed();
        if elapsed < target_frame_time {
            thread::sleep(target_frame_time - elapsed);
        }
    }

    let _ = frame_index;
}
