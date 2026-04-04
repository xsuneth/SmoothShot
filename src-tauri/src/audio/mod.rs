// Audio pipeline module
//
// Currently exposes configuration types and stub commands.
// Real capture (WASAPI loopback + microphone) is a planned Phase 4 feature.

pub mod mic_capture;
pub mod sync;
pub mod wasapi_loopback;

use serde::{Deserialize, Serialize};
use std::process::Command;

use crate::export::ffmpeg_sidecar::resolve_ffmpeg;

// ── Audio configuration ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioConfig {
    /// Whether to capture system audio (loopback).
    pub system_audio_enabled: bool,
    /// Whether to capture from the default microphone.
    pub mic_enabled: bool,
    /// Linear gain multiplier for system audio (1.0 = 100 %).
    pub system_audio_gain: f32,
    /// Linear gain multiplier for microphone audio (1.0 = 100 %).
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
    /// Platform reports that a loopback device is present.
    pub system_audio_available: bool,
    /// Platform reports that a microphone device is present.
    pub mic_available: bool,
    pub system_audio_enabled: bool,
    pub mic_enabled: bool,
    pub system_audio_gain: f32,
    pub mic_gain: f32,
}

impl AudioStatus {
    pub fn from_config(config: &AudioConfig) -> Self {
        let system_audio_available = find_dshow_audio_device("virtual-audio-capturer").is_some();
        let mic_available = find_first_input_mic_device().is_some();

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

fn list_dshow_audio_devices() -> Vec<String> {
    list_dshow_devices("audio")
}

pub fn list_dshow_video_devices() -> Vec<String> {
    list_dshow_devices("video")
}

pub fn list_input_mic_devices() -> Vec<String> {
    list_dshow_audio_devices()
        .into_iter()
        .filter(|device| {
            let lowered = device.to_ascii_lowercase();
            !lowered.contains("virtual-audio-capturer")
                && !lowered.contains("screen-capture-recorder")
                && !lowered.contains("output")
        })
        .collect()
}

pub fn find_dshow_audio_device(preferred_name: &str) -> Option<String> {
    let preferred_lower = preferred_name.to_ascii_lowercase();
    let devices = list_dshow_audio_devices();

    devices
        .iter()
        .find(|device| device.to_ascii_lowercase() == preferred_lower)
        .cloned()
        .or_else(|| {
            devices
                .iter()
                .find(|device| device.to_ascii_lowercase().contains(&preferred_lower))
                .cloned()
        })
}

pub fn find_first_input_mic_device() -> Option<String> {
    list_input_mic_devices().into_iter().next()
}
