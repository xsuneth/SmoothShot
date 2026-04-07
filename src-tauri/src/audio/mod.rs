// Audio pipeline module

pub mod mic_capture;
pub mod sync;
pub mod wasapi_loopback;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::thread::JoinHandle;

use crate::export::ffmpeg_sidecar::resolve_ffmpeg;

// ── Configuration ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioConfig {
    pub system_audio_enabled: bool,
    pub mic_enabled: bool,
    pub system_audio_gain: f32,
    pub mic_gain: f32,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            system_audio_enabled: true,
            mic_enabled: false,
            system_audio_gain: 1.0,
            mic_gain: 1.0,
        }
    }
}

// ── Status returned to the UI ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub system_audio_available: bool,
    pub mic_available: bool,
    pub system_audio_enabled: bool,
    pub mic_enabled: bool,
    pub system_audio_gain: f32,
    pub mic_gain: f32,
}

impl AudioStatus {
    pub fn from_config(config: &AudioConfig) -> Self {
        // Use WASAPI probe (no VB-Cable needed) for system audio.
        let system_audio_available = wasapi_loopback::is_loopback_available();
        let mic_available = mic_capture::is_mic_available();

        Self {
            system_audio_available,
            mic_available,
            system_audio_enabled: config.system_audio_enabled && system_audio_available,
            mic_enabled: config.mic_enabled && mic_available,
            system_audio_gain: config.system_audio_gain,
            mic_gain: config.mic_gain,
        }
    }
}

// ── Capture thread handles ────────────────────────────────────────────────────

#[derive(Debug)]
pub struct AudioCaptureHandles {
    pub sys_audio_path: Option<PathBuf>,
    pub mic_audio_path: Option<PathBuf>,
    pub sys_handle: Option<JoinHandle<()>>,
    pub mic_handle: Option<JoinHandle<()>>,
}

/// Start audio capture threads for system audio and/or mic, depending on
/// `config`.  Returns handles and the paths of the WAV files being written.
pub fn start_audio_capture(
    session_dir: &Path,
    config: &AudioConfig,
    stop_signal: Arc<AtomicBool>,
    mic_device_name: Option<String>,
) -> AudioCaptureHandles {
    let mut handles = AudioCaptureHandles {
        sys_audio_path: None,
        mic_audio_path: None,
        sys_handle: None,
        mic_handle: None,
    };

    if config.system_audio_enabled && wasapi_loopback::is_loopback_available() {
        let path = session_dir.join("sys_audio.wav");
        handles.sys_handle = wasapi_loopback::start_loopback_capture(
            path.clone(),
            Arc::clone(&stop_signal),
        );
        if handles.sys_handle.is_some() {
            handles.sys_audio_path = Some(path);
        }
    }

    if config.mic_enabled && mic_capture::is_mic_available() {
        let path = session_dir.join("mic_audio.wav");
        handles.mic_handle = mic_capture::start_mic_capture(
            mic_device_name,
            path.clone(),
            Arc::clone(&stop_signal),
        );
        if handles.mic_handle.is_some() {
            handles.mic_audio_path = Some(path);
        }
    }

    handles
}

/// Stop audio threads (join) and mux the resulting WAV files into the video.
///
/// `video_path` — the raw video-only MP4 from the screen capture backend
/// `output_path` — final source.mp4 to produce (video + audio)
///
/// If no audio was captured, simply renames the video to output_path.
/// Returns the final output path.
pub fn stop_and_mux_audio(
    mut handles: AudioCaptureHandles,
    _stop_signal: &Arc<AtomicBool>,
    video_path: &Path,
    output_path: &Path,
    config: &AudioConfig,
) -> Result<(), String> {
    // Signal audio threads to stop (video thread already signalled by caller).
    // Stop signal is shared — already set. Just join threads.
    if let Some(h) = handles.sys_handle.take() {
        let _ = h.join();
    }
    if let Some(h) = handles.mic_handle.take() {
        let _ = h.join();
    }

    let sys = handles.sys_audio_path.as_deref();
    let mic = handles.mic_audio_path.as_deref();

    let has_sys = sys.map(|p| p.exists()).unwrap_or(false);
    let has_mic = mic.map(|p| p.exists()).unwrap_or(false);

    if !has_sys && !has_mic {
        // No audio — just rename the raw video to the final output.
        if video_path != output_path {
            std::fs::rename(video_path, output_path)
                .map_err(|e| format!("rename video_raw to source: {e}"))?;
        }
        return Ok(());
    }

    mux_with_ffmpeg(
        video_path,
        if has_sys { sys } else { None },
        if has_mic { mic } else { None },
        output_path,
        config.system_audio_gain,
        config.mic_gain,
    )?;

    // Clean up temp audio files.
    if has_sys { if let Some(p) = sys { let _ = std::fs::remove_file(p); } }
    if has_mic { if let Some(p) = mic { let _ = std::fs::remove_file(p); } }

    Ok(())
}

fn mux_with_ffmpeg(
    video_path: &Path,
    sys_audio: Option<&Path>,
    mic_audio: Option<&Path>,
    output_path: &Path,
    sys_gain: f32,
    mic_gain: f32,
) -> Result<(), String> {
    let ffmpeg = resolve_ffmpeg()?;
    let mut cmd = Command::new(ffmpeg);

    cmd.arg("-y").arg("-i").arg(video_path);

    let mut audio_input_count = 0usize;
    if let Some(p) = sys_audio {
        cmd.arg("-i").arg(p);
        audio_input_count += 1;
    }
    if let Some(p) = mic_audio {
        cmd.arg("-i").arg(p);
        audio_input_count += 1;
    }

    // Build filter_complex for audio mixing with per-track gain.
    let filter = build_audio_filter(
        sys_audio.is_some(),
        mic_audio.is_some(),
        audio_input_count,
        sys_gain,
        mic_gain,
    );

    cmd.arg("-filter_complex").arg(&filter);
    cmd.arg("-map").arg("0:v");
    cmd.arg("-map").arg("[audio_out]");
    cmd.arg("-c:v").arg("copy");
    cmd.arg("-c:a").arg("aac").arg("-b:a").arg("256k");
    cmd.arg("-movflags").arg("+faststart");
    cmd.arg(output_path);

    let status = cmd
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("FFmpeg mux failed to start: {e}"))?;

    if !status.success() {
        return Err(format!(
            "FFmpeg mux exited with code {:?}",
            status.code()
        ));
    }

    Ok(())
}

fn build_audio_filter(
    has_sys: bool,
    has_mic: bool,
    input_count: usize,
    sys_gain: f32,
    mic_gain: f32,
) -> String {
    // Input indices: video = 0, then audio inputs in order.
    match (has_sys, has_mic) {
        (true, true) => {
            // Two audio inputs: mix both with individual gain.
            format!(
                "[1:a]volume={sys_gain:.3}[sa];[2:a]volume={mic_gain:.3}[ma];[sa][ma]amix=inputs=2:normalize=0[audio_out]"
            )
        }
        (true, false) => {
            format!("[1:a]volume={sys_gain:.3}[audio_out]")
        }
        (false, true) => {
            let idx = if input_count == 1 { 1 } else { 2 };
            format!("[{idx}:a]volume={mic_gain:.3}[audio_out]")
        }
        (false, false) => String::new(), // should never reach here
    }
}

// ── DirectShow helpers (kept for camera/mic device enumeration) ───────────────

fn list_dshow_devices(kind: &str) -> Vec<String> {
    let ffmpeg = match resolve_ffmpeg() {
        Ok(path) => path,
        Err(_) => return Vec::new(),
    };

    let output = match Command::new(ffmpeg)
        .arg("-hide_banner")
        .arg("-list_devices")
        .arg("true")
        .arg("-f")
        .arg("dshow")
        .arg("-i")
        .arg("dummy")
        .output()
    {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };

    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    combined
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let marker = format!("({kind})");
            if !trimmed.contains(&marker) {
                return None;
            }
            let start = trimmed.find('"')?;
            let rest = &trimmed[start + 1..];
            let end = rest.find('"')?;
            Some(rest[..end].to_string())
        })
        .collect()
}

pub fn list_dshow_video_devices() -> Vec<String> {
    list_dshow_devices("video")
}

pub fn list_input_mic_devices() -> Vec<String> {
    list_dshow_devices("audio")
        .into_iter()
        .filter(|d| {
            let l = d.to_ascii_lowercase();
            !l.contains("virtual-audio-capturer") && !l.contains("screen-capture-recorder")
        })
        .collect()
}

pub fn find_first_input_mic_device() -> Option<String> {
    list_input_mic_devices().into_iter().next()
}

// Kept for compatibility — no longer needed for system audio capture.
pub fn find_dshow_audio_device(_preferred_name: &str) -> Option<String> {
    None
}
