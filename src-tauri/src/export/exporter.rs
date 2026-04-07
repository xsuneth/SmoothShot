// Export pipeline — FFmpeg filtergraph
//
// Reads source.mp4 and applies all effects (trim, zoom, padding, background)
// in a single FFmpeg pass. No RGBA decode/re-encode: quality is preserved and
// the pipeline works correctly on both Windows (gfxcapture) and macOS paths.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::capture::{ClickEvent, SessionCaptureConfig, global_to_frame_coords};
use crate::export::ffmpeg_sidecar::resolve_ffmpeg;
use crate::timeline::zoom_track::ZoomProfile;

// ── Request / response ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRecordingRequest {
    /// Override output file path. Defaults to Desktop/smoothshot-{epoch}.mp4.
    pub output_path: Option<String>,
    // ── Zoom ──────────────────────────────────────────────────────────────────
    pub max_zoom: Option<f32>,
    pub zoom_in_ms: Option<u128>,
    pub hold_ms: Option<u128>,
    pub zoom_out_ms: Option<u128>,
    // ── Trim ─────────────────────────────────────────────────────────────────
    pub trim_start_ms: Option<u64>,
    pub trim_end_ms: Option<u64>,
    // ── Output ───────────────────────────────────────────────────────────────
    pub target_width: Option<u32>,
    pub target_height: Option<u32>,
    /// Padding in pixels added around the source video on all four sides.
    pub padding: Option<u32>,
    /// Background colour as a hex string without '#' (e.g. "0d131e").
    pub background_color: Option<String>,
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

// ── Default output path ───────────────────────────────────────────────────────

fn default_output_path() -> Result<PathBuf, String> {
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Prefer Desktop, fall back to system temp.
    let base = dirs_next::desktop_dir()
        .or_else(dirs_next::video_dir)
        .unwrap_or_else(std::env::temp_dir);

    Ok(base.join(format!("smoothshot-{epoch}.mp4")))
}

// ── Zoom expression builder ───────────────────────────────────────────────────

/// Build the `z` (zoom) expression string for `zoompan`.
///
/// Each click event contributes a zoom-in → hold → zoom-out curve.  Multiple
/// overlapping clicks are combined by taking the maximum zoom at every frame.
fn build_z_expr(
    click_events_local: &[(u128, i32, i32)],
    profile: &ZoomProfile,
    trim_start_ms: u64,
) -> String {
    if click_events_local.is_empty() {
        return "1".to_string();
    }

    // Ease-in-out-sine: (1 - cos(PI * p)) / 2
    // FFmpeg `cos` works in radians, PI is available as `PI`.
    let mut exprs: Vec<String> = Vec::with_capacity(click_events_local.len());

    for (click_time_ms, _, _) in click_events_local {
        // Adjust timestamps relative to the trim start so that t=0 in the
        // zoompan filter corresponds to the first output frame.
        let adjusted_ms = (*click_time_ms as i128) - (trim_start_ms as i128);
        if adjusted_ms < -(profile.zoom_in_ms as i128 + profile.hold_ms as i128 + profile.zoom_out_ms as i128) {
            continue; // click completely before the trim window
        }

        let t0 = adjusted_ms.max(0) as f64 / 1000.0;
        let zi_dur = profile.zoom_in_ms as f64 / 1000.0;
        let hd_dur = profile.hold_ms as f64 / 1000.0;
        let zo_dur = profile.zoom_out_ms as f64 / 1000.0;
        let t_zi_end = t0 + zi_dur;
        let t_hd_end = t_zi_end + hd_dur;
        let t_end = t_hd_end + zo_dur;
        let mz = profile.max_zoom;

        // Zoom-in phase: eased from 1 → max_zoom
        let in_expr = format!(
            "if(between(t,{t0:.4},{t_zi_end:.4}),\
             1+({mz:.4}-1)*(1-cos(PI*(t-{t0:.4})/{zi_dur:.4}))/2,\
             0)"
        );
        // Hold phase: constant max_zoom
        let hold_expr = format!(
            "if(between(t,{t_zi_end:.4},{t_hd_end:.4}),{mz:.4},0)"
        );
        // Zoom-out phase: eased from max_zoom → 1
        let out_expr = format!(
            "if(between(t,{t_hd_end:.4},{t_end:.4}),\
             {mz:.4}-({mz:.4}-1)*(1-cos(PI*(t-{t_hd_end:.4})/{zo_dur:.4}))/2,\
             0)"
        );

        exprs.push(format!("max({in_expr},max({hold_expr},{out_expr}))"));
    }

    // Combine all clicks by taking the maximum; floor at 1.
    exprs.into_iter().fold("1".to_string(), |acc, e| {
        format!("max({acc},{e})")
    })
}

/// Build the `x` or `y` pan expression for `zoompan`.
///
/// Returns the crop-offset expression that centres the view on the focus point
/// of the currently active click.  When no click is active, the view stays
/// centred (0 for x, 0 for y — which at zoom=1 shows the full frame).
fn build_xy_expr(
    click_events_local: &[(u128, i32, i32)],
    profile: &ZoomProfile,
    trim_start_ms: u64,
    axis: &str, // "x" or "y"
) -> String {
    if click_events_local.is_empty() {
        return "0".to_string();
    }

    let dim = if axis == "x" { "iw" } else { "ih" };

    // Chain if-expressions from last click to first so the first active click
    // wins (earliest click takes priority when events overlap).
    let mut expr = "0".to_string();

    for (click_time_ms, cx, cy) in click_events_local.iter().rev() {
        let adjusted_ms = (*click_time_ms as i128) - (trim_start_ms as i128);
        if adjusted_ms < -(profile.zoom_in_ms as i128 + profile.hold_ms as i128 + profile.zoom_out_ms as i128) {
            continue;
        }

        let t0 = adjusted_ms.max(0) as f64 / 1000.0;
        let t_end = t0
            + (profile.zoom_in_ms + profile.hold_ms + profile.zoom_out_ms) as f64 / 1000.0;
        let focus = if axis == "x" { *cx } else { *cy };

        // Crop offset to centre the focus point within the zoomed window.
        // At zoom z: crop size = dim/z, so offset = focus - dim/(2*z), clamped.
        let centered = format!(
            "max(0,min({dim}*(1-1/zoom),{focus}-{dim}/(2*zoom)))"
        );

        expr = format!("if(between(t,{t0:.4},{t_end:.4}),{centered},{expr})");
    }

    expr
}

// ── Filtergraph builder ───────────────────────────────────────────────────────

struct ExportParams<'a> {
    source_path: &'a PathBuf,
    click_events_local: &'a [(u128, i32, i32)],
    profile: &'a ZoomProfile,
    trim_start_ms: u64,
    trim_end_ms: Option<u64>,
    source_w: u32,
    source_h: u32,
    target_w: u32,
    target_h: u32,
    padding: u32,
    background_color: &'a str,
    fps: u32,
    output_path: &'a PathBuf,
    has_audio: bool,
}

fn run_ffmpeg_export(params: &ExportParams<'_>) -> Result<(), String> {
    let ffmpeg = resolve_ffmpeg()?;

    let z_expr = build_z_expr(params.click_events_local, params.profile, params.trim_start_ms);
    let x_expr = build_xy_expr(params.click_events_local, params.profile, params.trim_start_ms, "x");
    let y_expr = build_xy_expr(params.click_events_local, params.profile, params.trim_start_ms, "y");

    // Content area (source video area after padding is removed from edges).
    let content_w = params.target_w.saturating_sub(params.padding * 2).max(64);
    let content_h = params.target_h.saturating_sub(params.padding * 2).max(36);

    // Determine if we actually need zoompan (has clicks and max_zoom > 1).
    let needs_zoom = !params.click_events_local.is_empty() && params.profile.max_zoom > 1.001;

    // Build the video filtergraph.
    // Labels: [src] → optional [zoomed] → [scaled] → overlay on [bg] → [out]
    let mut vf_parts: Vec<String> = Vec::new();

    if needs_zoom {
        vf_parts.push(format!(
            "[0:v]zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}'\
             :d=1:fps={fps}:s={source_w}x{source_h}[zoomed]",
            fps = params.fps,
            source_w = params.source_w,
            source_h = params.source_h,
        ));
        vf_parts.push(format!(
            "[zoomed]scale={content_w}:{content_h}\
             :force_original_aspect_ratio=decrease:flags=lanczos[scaled]",
            content_w = content_w,
            content_h = content_h,
        ));
    } else {
        vf_parts.push(format!(
            "[0:v]scale={content_w}:{content_h}\
             :force_original_aspect_ratio=decrease:flags=lanczos[scaled]",
            content_w = content_w,
            content_h = content_h,
        ));
    }

    vf_parts.push(format!(
        "color=c=#{bg}:s={tw}x{th}:r={fps}[bg]",
        bg = params.background_color,
        tw = params.target_w,
        th = params.target_h,
        fps = params.fps,
    ));
    vf_parts.push(
        "[bg][scaled]overlay=(W-w)/2:(H-h)/2:shortest=1[out]".to_string(),
    );

    let filter_complex = vf_parts.join(";");

    let mut cmd = Command::new(&ffmpeg);
    cmd.arg("-y");

    // Trim: seek before input for fast seeking (keyframe-accurate enough for this use case).
    if params.trim_start_ms > 0 {
        cmd.arg("-ss").arg(format!("{:.3}", params.trim_start_ms as f64 / 1000.0));
    }
    if let Some(end) = params.trim_end_ms {
        let duration_s = (end.saturating_sub(params.trim_start_ms)) as f64 / 1000.0;
        cmd.arg("-t").arg(format!("{duration_s:.3}"));
    }

    cmd.arg("-i").arg(params.source_path);

    cmd.arg("-filter_complex").arg(&filter_complex);
    cmd.arg("-map").arg("[out]");

    if params.has_audio {
        cmd.arg("-map").arg("0:a:0?"); // optional audio stream
        cmd.arg("-c:a").arg("aac").arg("-b:a").arg("192k");
    }

    cmd.arg("-c:v").arg("libx264")
        .arg("-pix_fmt").arg("yuv420p")
        .arg("-preset").arg("veryfast")
        .arg("-crf").arg("18")
        .arg("-movflags").arg("+faststart")
        .arg(params.output_path);

    cmd.stdout(Stdio::null()).stderr(Stdio::piped());

    let output = cmd
        .spawn()
        .map_err(|err| format!("failed to start ffmpeg: {err}"))?
        .wait_with_output()
        .map_err(|err| format!("failed waiting for ffmpeg: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ffmpeg export failed:\n{stderr}"));
    }

    Ok(())
}

// ── Public export entry point ─────────────────────────────────────────────────

/// Run the complete export pipeline.
///
/// Reads `source_video_path`, applies trim / zoom / background / padding via an
/// FFmpeg filtergraph, and writes the final MP4 to disk.
pub fn export_recording(
    source_video_path: &str,
    click_events: &[ClickEvent],
    session_capture: &SessionCaptureConfig,
    target_fps: u32,
    session_duration_ms: u128,
    request: &ExportRecordingRequest,
) -> Result<ExportRecordingResponse, String> {
    let source_path = PathBuf::from(source_video_path);
    if !source_path.exists() {
        return Err(format!(
            "source video not found at {}: cannot export",
            source_path.display()
        ));
    }

    let output_path = match &request.output_path {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p.trim()),
        _ => default_output_path()?,
    };

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create output directory: {err}"))?;
        }
    }

    let profile = ZoomProfile {
        zoom_in_ms: request.zoom_in_ms.unwrap_or(180),
        hold_ms: request.hold_ms.unwrap_or(120),
        zoom_out_ms: request.zoom_out_ms.unwrap_or(260),
        max_zoom: request.max_zoom.unwrap_or(1.85).clamp(1.0, 4.0),
        easing: "ease-in-out-sine".to_string(),
    };

    let trim_start_ms = request.trim_start_ms.unwrap_or(0);
    let trim_end_ms = request.trim_end_ms.filter(|&e| e > trim_start_ms);
    let output_duration_ms = trim_end_ms
        .map(|e| (e - trim_start_ms) as u128)
        .unwrap_or(session_duration_ms.saturating_sub(trim_start_ms as u128));

    let target_w = request.target_width.unwrap_or(1920);
    let target_h = request.target_height.unwrap_or(1080);
    let padding = request.padding.unwrap_or(0).min(target_w.min(target_h) / 4);
    let background_color = request
        .background_color
        .as_deref()
        .unwrap_or("0d131e")
        .trim_start_matches('#');

    let source_w = session_capture.source_width;
    let source_h = session_capture.source_height;
    let fps = target_fps.max(1);

    // Convert click events from global screen coords to source-video-local coords.
    let click_events_local: Vec<(u128, i32, i32)> = click_events
        .iter()
        .map(|c| {
            let (lx, ly) = global_to_frame_coords(c.cursor_x, c.cursor_y, session_capture);
            (c.timestamp_ms, lx.clamp(0, source_w as i32 - 1), ly.clamp(0, source_h as i32 - 1))
        })
        .collect();

    // Check whether source has an audio track (best-effort probe).
    let has_audio = probe_has_audio(&resolve_ffmpeg()?, &source_path);

    run_ffmpeg_export(&ExportParams {
        source_path: &source_path,
        click_events_local: &click_events_local,
        profile: &profile,
        trim_start_ms,
        trim_end_ms,
        source_w,
        source_h,
        target_w,
        target_h,
        padding,
        background_color,
        fps,
        output_path: &output_path,
        has_audio,
    })?;

    let frames_exported = ((output_duration_ms * fps as u128) / 1000) as usize;

    Ok(ExportRecordingResponse {
        output_path: output_path.to_string_lossy().to_string(),
        frames_exported,
        width: target_w,
        height: target_h,
        target_fps: fps,
        output_duration_ms,
    })
}

// ── Audio probe ───────────────────────────────────────────────────────────────

fn probe_has_audio(ffmpeg: &PathBuf, path: &PathBuf) -> bool {
    // Use ffprobe if available; otherwise try ffmpeg -i and check stderr.
    let ffprobe = ffmpeg
        .parent()
        .map(|d| {
            let name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
            d.join(name)
        })
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" }));

    let result = Command::new(&ffprobe)
        .args(["-v", "error", "-select_streams", "a:0",
               "-show_entries", "stream=codec_type",
               "-of", "csv=p=0"])
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();

    match result {
        Ok(out) => !out.stdout.is_empty(),
        Err(_) => false,
    }
}
