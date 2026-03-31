// Audio pipeline module
//
// Currently exposes configuration types and stub commands.
// Real capture (WASAPI loopback + microphone) is a planned Phase 4 feature.

pub mod mic_capture;
pub mod sync;
pub mod wasapi_loopback;

use serde::{Deserialize, Serialize};

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
        // TODO: query real device availability via WASAPI / CoreAudio.
        Self {
            system_audio_available: false,
            mic_available: false,
            system_audio_enabled: config.system_audio_enabled,
            mic_enabled: config.mic_enabled,
            system_audio_gain: config.system_audio_gain,
            mic_gain: config.mic_gain,
        }
    }
}
