// Export pipeline
//
// Drives the CPU-based render path: blends captured frames, applies zoom and
// cursor overlays, and hands the resulting RGBA stream to FFmpeg for encoding.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::capture::global_to_frame_coords;
use crate::capture::{ClickEvent, RawFrame, SessionCaptureConfig};
use crate::export::ffmpeg_sidecar::resolve_ffmpeg;
use crate::render::compositor::{
    apply_zoom_transform_rgba, blend_frames_rgba, draw_cursor_overlay_rgba, map_point_through_zoom,
};
use crate::timeline::zoom_track::{zoom_from_click, ZoomProfile};

// ── Request / response ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRecordingRequest {
    pub output_path: Option<String>,
    pub max_zoom: Option<f32>,
    pub zoom_in_ms: Option<u128>,
    pub hold_ms: Option<u128>,
    pub zoom_out_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRecordingResponse {
    pub output_path: String,
    pub frames_exported: usize,
    pub width: u32,
    pub height: u32,
    pub target_fps: u32,
    pub output_duration_ms: u128,
}

#[derive(Debug, Clone, Copy)]
pub struct RenderOptions {
    pub apply_zoom: bool,
    pub draw_cursor: bool,
}

// ── Frame sampling ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub struct ExportFrameSample {
    pub left_index: usize,
    pub right_index: usize,
    pub blend: f32,
    pub timestamp_ms: u128,
}

pub fn build_export_frame_samples(
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

// ── Zoom helpers ──────────────────────────────────────────────────────────────

pub fn best_zoom_and_focus(
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

// ── Core export function ──────────────────────────────────────────────────────

/// Run the full export pipeline to produce a final MP4.
pub fn run_export(
    frames: &[RawFrame],
    click_events: &[ClickEvent],
    session_capture: &SessionCaptureConfig,
    target_fps: u32,
    session_duration_ms: u128,
    profile: &ZoomProfile,
    render_options: RenderOptions,
    output_path: &PathBuf,
    output_scale: &str,
    preset: &str,
) -> Result<(usize, u32, u32), String> {
    if frames.is_empty() {
        return Err("no captured frames available to export".to_string());
    }

    let ffmpeg = resolve_ffmpeg()?;

    let width = frames[0].width;
    let height = frames[0].height;
    let fps = target_fps.max(1);
    let export_frame_samples = build_export_frame_samples(frames, fps, session_duration_ms);

    let click_events_local: Vec<(u128, i32, i32)> = click_events
        .iter()
        .map(|click| {
            let (local_x, local_y) =
                global_to_frame_coords(click.cursor_x, click.cursor_y, session_capture);
            (click.timestamp_ms, local_x, local_y)
        })
        .collect();

    let mut child = Command::new(&ffmpeg)
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
        .arg(format!("scale={output_scale}:flags=lanczos"))
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-preset")
        .arg(preset)
        .arg("-movflags")
        .arg("+faststart")
        .arg(output_path.to_string_lossy().as_ref())
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
        let left_frame = &frames[sample.left_index];
        let right_frame = &frames[sample.right_index];

        let blended_cursor_x = (left_frame.cursor_x as f32 * (1.0 - sample.blend)
            + right_frame.cursor_x as f32 * sample.blend)
            .round() as i32;
        let blended_cursor_y = (left_frame.cursor_y as f32 * (1.0 - sample.blend)
            + right_frame.cursor_y as f32 * sample.blend)
            .round() as i32;

        let source_pixels = blend_frames_rgba(
            &left_frame.pixels_rgba,
            &right_frame.pixels_rgba,
            sample.blend,
        );

        let (zoom, focus_x_global, focus_y_global) = if render_options.apply_zoom {
            best_zoom_and_focus(
                sample.timestamp_ms,
                blended_cursor_x,
                blended_cursor_y,
                click_events,
                profile,
            )
        } else {
            (1.0, blended_cursor_x, blended_cursor_y)
        };

        let (focus_x_local, focus_y_local) =
            global_to_frame_coords(focus_x_global, focus_y_global, session_capture);
        let (cursor_x_local, cursor_y_local) =
            global_to_frame_coords(blended_cursor_x, blended_cursor_y, session_capture);

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

        if render_options.draw_cursor {
            draw_cursor_overlay_rgba(
                &mut transformed,
                left_frame.width,
                left_frame.height,
                cursor_mapped_x,
                cursor_mapped_y,
                sample.timestamp_ms,
                &mapped_clicks,
            );
        }

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

    Ok((export_frame_samples.len(), width, height))
}

/// Produce the final high-quality export from captured frames.
pub fn export_recording(
    frames: &[RawFrame],
    click_events: &[ClickEvent],
    session_capture: &SessionCaptureConfig,
    target_fps: u32,
    session_duration_ms: u128,
    request: &ExportRecordingRequest,
) -> Result<ExportRecordingResponse, String> {
    let profile = ZoomProfile {
        zoom_in_ms: request.zoom_in_ms.unwrap_or(180),
        hold_ms: request.hold_ms.unwrap_or(120),
        zoom_out_ms: request.zoom_out_ms.unwrap_or(260),
        max_zoom: request.max_zoom.unwrap_or(1.85).clamp(1.05, 3.0),
        easing: "ease-in-out-sine".to_string(),
    };

    let output_path = if let Some(path) = &request.output_path {
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
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create output directory: {err}"))?;
    }

    let (frames_exported, _src_w, _src_h) = run_export(
        frames,
        click_events,
        session_capture,
        target_fps,
        session_duration_ms,
        &profile,
        RenderOptions {
            apply_zoom: true,
            draw_cursor: true,
        },
        &output_path,
        "1920:1080",
        "veryfast",
    )?;

    let fps = target_fps.max(1);
    Ok(ExportRecordingResponse {
        output_path: output_path.to_string_lossy().to_string(),
        frames_exported,
        width: 1920,
        height: 1080,
        target_fps: fps,
        output_duration_ms: ((frames_exported.saturating_sub(1) as u128) * 1000) / fps as u128,
    })
}
