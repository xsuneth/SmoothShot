use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use device_query::{DeviceQuery, DeviceState};
use screenshots::Screen;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::export::ffmpeg_sidecar::resolve_ffmpeg;

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
    pub is_paused: bool,
    pub target_fps: u32,
    pub frames_captured: usize,
    pub clicks_detected: usize,
    /// Wall-clock recording time excluding paused intervals (ms).
    pub elapsed_ms: u128,
    /// Session folder path — set while recording is active.
    pub session_folder: Option<String>,
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
    /// Path to the captured source MP4 written during recording.
    pub source_video_path: Option<String>,
    /// Path to the proxy MP4 (set after calling generate_preview_proxy).
    pub proxy_path: Option<String>,
    /// Path to the camera MP4 recorded alongside screen capture.
    pub camera_video_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayDescriptor {
    pub index: usize,
    pub id: u32,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub scale_factor: f32,
    pub frequency: f32,
    pub preview_path: Option<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrameResponse {
    pub timestamp_ms: u128,
    pub width: u32,
    pub height: u32,
    pub pixels_rgba: Vec<u8>,
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

struct SourceVideoWriter {
    child: Child,
    stdin: ChildStdin,
}

struct SourceVideoFrame {
    pixels_rgba: Vec<u8>,
    repeat: u32,
}

struct SourceVideoWorker {
    sender: SyncSender<SourceVideoFrame>,
    handle: JoinHandle<()>,
}

fn spawn_source_video_writer(
    output_path: &PathBuf,
    width: u32,
    height: u32,
    target_fps: u32,
) -> Result<SourceVideoWriter, String> {
    let ffmpeg = resolve_ffmpeg()?;
    let mut command = Command::new(ffmpeg);
    command
        .arg("-y")
        .arg("-f")
        .arg("rawvideo")
        .arg("-pixel_format")
        .arg("rgba")
        .arg("-video_size")
        .arg(format!("{width}x{height}"))
        .arg("-framerate")
        .arg(target_fps.max(1).to_string())
        .arg("-i")
        .arg("-");

    command.arg("-map").arg("0:v:0");

    command
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-preset")
        .arg("ultrafast");

    let mut child = command
        .arg("-movflags")
        .arg("+faststart")
        .arg(output_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start source video writer: {err}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to open source video writer stdin".to_string())?;

    Ok(SourceVideoWriter { child, stdin })
}

fn spawn_source_video_worker(
    output_path: &PathBuf,
    width: u32,
    height: u32,
    target_fps: u32,
) -> Result<SourceVideoWorker, String> {
    let writer = spawn_source_video_writer(output_path, width, height, target_fps)?;
    let (sender, receiver) = sync_channel::<SourceVideoFrame>(8);

    let handle = thread::spawn(move || {
        let mut writer = writer;

        while let Ok(frame) = receiver.recv() {
            for _ in 0..frame.repeat.max(1) {
                if writer.stdin.write_all(&frame.pixels_rgba).is_err() {
                    drop(writer.stdin);
                    let _ = writer.child.wait();
                    return;
                }
            }
        }

        drop(writer.stdin);
        let _ = writer.child.wait();
    });

    Ok(SourceVideoWorker { sender, handle })
}

// ── Capture configuration ─────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct SessionCaptureConfig {
    pub display_index: usize,
    pub display_origin_x: i32,
    pub display_origin_y: i32,
    pub region: Option<CaptureRegion>,
    pub source_width: u32,
    pub source_height: u32,
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
            raw_bytes: if frame.pixels_rgba.is_empty() {
                (frame.width as usize)
                    .saturating_mul(frame.height as usize)
                    .saturating_mul(4)
            } else {
                frame.pixels_rgba.len()
            },
            cursor_x: frame.cursor_x,
            cursor_y: frame.cursor_y,
            click_in_frame,
        });
    }

    items
}

pub fn calculate_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    let sum_squares = samples
        .iter()
        .fold(0.0_f32, |acc, sample| acc + sample * sample);
    (sum_squares / samples.len() as f32).sqrt()
}

fn emit_mic_level(app_handle: &AppHandle, level: f32) {
    let _ = app_handle.emit_to("main", "mic-level", level);
    let _ = app_handle.emit_to("editor", "mic-level", level);
    let _ = app_handle.emit("mic-level", level);
}

pub fn start_mic_level_emitter(
    app_handle: AppHandle,
    stop_signal: Arc<AtomicBool>,
) -> Option<JoinHandle<()>> {
    let host = cpal::default_host();
    let device = host.default_input_device()?;
    let config = device.default_input_config().ok()?;

    Some(thread::spawn(move || {
        let err_callback = |_err: cpal::StreamError| {
            // Ignore intermittent input stream errors; metering can recover next session.
        };

        let stream_result = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                let stream_config = config.config();
                let app_handle = app_handle.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _| {
                        let rms = calculate_rms(data);
                        let boosted = (rms * 3.2).min(1.0);
                        emit_mic_level(&app_handle, boosted);
                    },
                    err_callback,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let stream_config = config.config();
                let app_handle = app_handle.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| {
                        let mut normalized = Vec::with_capacity(data.len());
                        for sample in data {
                            normalized.push(*sample as f32 / i16::MAX as f32);
                        }
                        let rms = calculate_rms(&normalized);
                        let boosted = (rms * 3.2).min(1.0);
                        emit_mic_level(&app_handle, boosted);
                    },
                    err_callback,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let stream_config = config.config();
                let app_handle = app_handle.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[u16], _| {
                        let mut normalized = Vec::with_capacity(data.len());
                        for sample in data {
                            normalized.push((*sample as f32 / u16::MAX as f32) * 2.0 - 1.0);
                        }
                        let rms = calculate_rms(&normalized);
                        let boosted = (rms * 3.2).min(1.0);
                        emit_mic_level(&app_handle, boosted);
                    },
                    err_callback,
                    None,
                )
            }
            _ => return,
        };

        let Ok(stream) = stream_result else {
            return;
        };

        if stream.play().is_err() {
            return;
        }

        while !stop_signal.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(16));
        }
    }))
}

// ── Capture loop (CPU screenshot polling backend) ─────────────────────────────

pub fn capture_loop(
    target_fps: u32,
    capture_screen: Screen,
    session_capture: SessionCaptureConfig,
    stop_signal: Arc<AtomicBool>,
    pause_signal: Arc<AtomicBool>,
    started_at: Instant,
    raw_frames: Arc<Mutex<Vec<RawFrame>>>,
    click_events: Arc<Mutex<Vec<ClickEvent>>>,
    source_video_path: Option<String>,
) {
    #[cfg(target_os = "windows")]
    {
        if let Some(path) = source_video_path.as_ref().map(PathBuf::from) {
            capture_loop_windows(
                target_fps,
                &session_capture,
                stop_signal,
                pause_signal,
                started_at,
                raw_frames,
                click_events,
                path,
            );
            return;
        }
    }

    capture_loop_polling(
        target_fps,
        capture_screen,
        session_capture,
        stop_signal,
        pause_signal,
        started_at,
        raw_frames,
        click_events,
        source_video_path,
    );
}

#[cfg(target_os = "windows")]
fn build_ddagrab_filter(session_capture: &SessionCaptureConfig, target_fps: u32) -> String {
    let (offset_x, offset_y, width, height) = if let Some(region) = &session_capture.region {
        (
            region.x - session_capture.display_origin_x,
            region.y - session_capture.display_origin_y,
            region.width,
            region.height,
        )
    } else {
        (
            0,
            0,
            session_capture.source_width,
            session_capture.source_height,
        )
    };

    format!(
        "ddagrab=output_idx={}:framerate={}:draw_mouse=0:video_size={}x{}:offset_x={}:offset_y={}:dup_frames=1,hwdownload,format=bgra,format=nv12[v]",
        session_capture.display_index,
        target_fps.max(1),
        width.max(1),
        height.max(1),
        offset_x.max(0),
        offset_y.max(0),
    )
}

/// Spawn FFmpeg ddagrab — video only, no audio inputs.
/// Audio is captured in separate threads and muxed after stop.
#[cfg(target_os = "windows")]
fn spawn_source_capture_process(
    output_path: &PathBuf,
    session_capture: &SessionCaptureConfig,
    target_fps: u32,
) -> Result<Child, String> {
    let ffmpeg = resolve_ffmpeg()?;
    Command::new(ffmpeg)
        .arg("-y")
        .arg("-filter_complex")
        .arg(build_ddagrab_filter(session_capture, target_fps))
        .arg("-map")
        .arg("[v]")
        .arg("-c:v")
        .arg("h264_mf")
        .arg("-hw_encoding")
        .arg("1")
        .arg("-scenario")
        .arg("display_remoting")
        .arg("-rate_control")
        .arg("ld_vbr")
        .arg("-b:v")
        .arg("20000k")
        .arg("-maxrate")
        .arg("40000k")
        .arg("-bufsize")
        .arg("40000k")
        .arg("-r")
        .arg(target_fps.max(1).to_string())
        .arg("-g")
        .arg(target_fps.max(1).to_string())
        .arg("-movflags")
        .arg("+faststart")
        .arg(output_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start Desktop Duplication recorder: {err}"))
}

#[cfg(target_os = "windows")]
fn capture_loop_windows(
    target_fps: u32,
    session_capture: &SessionCaptureConfig,
    stop_signal: Arc<AtomicBool>,
    pause_signal: Arc<AtomicBool>,
    _started_at: Instant,
    raw_frames: Arc<Mutex<Vec<RawFrame>>>,
    click_events: Arc<Mutex<Vec<ClickEvent>>>,
    source_video_path: PathBuf,
) {
    let device_state = DeviceState::new();
    let cursor_sample_hz = target_fps.max(1).saturating_mul(4).clamp(120, 240);
    let target_frame_time = Duration::from_secs_f64(1.0 / cursor_sample_hz as f64);
    let mut previous_buttons = vec![false; 8];
    let mut ffmpeg_child =
        spawn_source_capture_process(&source_video_path, session_capture, target_fps).ok();
    let capture_started_at = Instant::now();

    while !stop_signal.load(Ordering::Relaxed) {
        let frame_started = Instant::now();

        // While paused: skip cursor/click tracking, just sleep and poll signals.
        if pause_signal.load(Ordering::Relaxed) {
            thread::sleep(target_frame_time);
            continue;
        }

        let mouse = device_state.get_mouse();
        let timestamp_ms = capture_started_at.elapsed().as_millis();

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
                width: session_capture.source_width,
                height: session_capture.source_height,
                cursor_x: mouse.coords.0,
                cursor_y: mouse.coords.1,
                pixels_rgba: Vec::new(),
            });
        }

        let elapsed = frame_started.elapsed();
        if elapsed < target_frame_time {
            thread::sleep(target_frame_time - elapsed);
        }
    }

    if let Some(mut child) = ffmpeg_child.take() {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(b"q\n");
        }
        let _ = child.wait();
    }
}

fn capture_loop_polling(
    target_fps: u32,
    capture_screen: Screen,
    session_capture: SessionCaptureConfig,
    stop_signal: Arc<AtomicBool>,
    pause_signal: Arc<AtomicBool>,
    _started_at: Instant,
    raw_frames: Arc<Mutex<Vec<RawFrame>>>,
    click_events: Arc<Mutex<Vec<ClickEvent>>>,
    source_video_path: Option<String>,
) {
    let device_state = DeviceState::new();
    let mut source_writer: Option<SourceVideoWorker> = None;

    let mut frame_index: u64 = 0;
    let mut encoded_frame_count: u64 = 0;
    let mut last_frame_pixels: Option<Vec<u8>> = None;
    let mut previous_buttons = vec![false; 8];
    let target_frame_time = Duration::from_secs_f64(1.0 / target_fps as f64);
    let frame_duration_ms = 1000.0 / target_fps.max(1) as f64;
    let mut capture_started_at: Option<Instant> = None;

    while !stop_signal.load(Ordering::Relaxed) {
        let frame_started = Instant::now();

        if pause_signal.load(Ordering::Relaxed) {
            thread::sleep(target_frame_time);
            continue;
        }

        let mouse = device_state.get_mouse();

        let capture_result = if let Some(active_region) = &session_capture.region {
            let local_x = active_region.x - capture_screen.display_info.x;
            let local_y = active_region.y - capture_screen.display_info.y;
            capture_screen.capture_area(local_x, local_y, active_region.width, active_region.height)
        } else {
            capture_screen.capture()
        };

        if let Ok(image) = capture_result {
            let capture_started_at = *capture_started_at.get_or_insert_with(Instant::now);
            let timestamp_ms = capture_started_at.elapsed().as_millis();
            let current_buttons = mouse.button_pressed;
            let width = image.width();
            let height = image.height();
            let pixels_rgba = image.into_raw();

            if source_writer.is_none() {
                if let Some(path) = source_video_path.as_ref().map(PathBuf::from) {
                    if let Ok(writer) =
                        spawn_source_video_worker(&path, width, height, target_fps)
                    {
                        source_writer = Some(writer);
                    }
                }
            }

            if let Some(writer) = source_writer.as_mut() {
                let due_frame_count =
                    ((timestamp_ms as f64 / frame_duration_ms).floor() as u64).saturating_add(1);
                let frames_to_write =
                    due_frame_count.saturating_sub(encoded_frame_count).max(1) as u32;

                match writer.sender.try_send(SourceVideoFrame {
                    pixels_rgba: pixels_rgba.clone(),
                    repeat: frames_to_write,
                }) {
                    Ok(()) => {
                        encoded_frame_count =
                            encoded_frame_count.saturating_add(frames_to_write as u64);
                    }
                    Err(TrySendError::Full(_)) => {
                        // Let the next successful frame catch up in duration without stalling capture.
                    }
                    Err(TrySendError::Disconnected(_)) => {
                        source_writer = None;
                    }
                }
            }

            last_frame_pixels = Some(pixels_rgba);

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
                    width,
                    height,
                    cursor_x: mouse.coords.0,
                    cursor_y: mouse.coords.1,
                    pixels_rgba: Vec::new(),
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
    if let Some(writer) = source_writer {
        if let Some(last_pixels) = last_frame_pixels.as_ref() {
            let final_timestamp_ms = capture_started_at
                .map(|started| started.elapsed().as_millis())
                .unwrap_or_default();
            let final_frame_count = ((final_timestamp_ms as f64 / frame_duration_ms).ceil() as u64)
                .max(encoded_frame_count);

            while encoded_frame_count < final_frame_count {
                let repeat = (final_frame_count - encoded_frame_count).min(u32::MAX as u64) as u32;
                if writer
                    .sender
                    .send(SourceVideoFrame {
                        pixels_rgba: last_pixels.clone(),
                        repeat,
                    })
                    .is_err()
                {
                    break;
                }
                encoded_frame_count = encoded_frame_count.saturating_add(repeat as u64);
            }
        }
        let SourceVideoWorker { sender, handle } = writer;
        drop(sender);
        let _ = handle.join();
    }
}
