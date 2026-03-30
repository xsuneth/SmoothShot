use device_query::{DeviceQuery, DeviceState};
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

    let frames = recorder
        .raw_frames
        .lock()
        .map_err(|_| "failed to lock frame buffer".to_string())?;

    let max_items = limit.unwrap_or(300).clamp(1, 5_000);
    let start_index = frames.len().saturating_sub(max_items);

    Ok(frames[start_index..]
        .iter()
        .enumerate()
        .map(|(index, frame)| FrameMetadata {
            frame_index: (start_index + index) as u64,
            timestamp_ms: frame.timestamp_ms,
            width: frame.width,
            height: frame.height,
            raw_bytes: frame.pixels_rgba.len(),
            cursor_x: frame.cursor_x,
            cursor_y: frame.cursor_y,
            click_in_frame: false,
        })
        .collect())
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
            export_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
