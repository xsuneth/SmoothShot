// Preview session
//
// Generates a lightweight proxy video from the current in-memory capture so
// that the editor can show real playback immediately after recording, without
// waiting for the full high-quality export.

use std::path::PathBuf;

use serde::Serialize;

use crate::capture::{ClickEvent, RawFrame, SessionCaptureConfig};
use crate::export::exporter::run_export;
use crate::timeline::zoom_track::ZoomProfile;

// ── Response ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePreviewProxyResponse {
    /// Absolute (or relative) path to the generated proxy MP4.
    pub proxy_path: String,
    pub duration_ms: u128,
    pub width: u32,
    pub height: u32,
    pub target_fps: u32,
}

// ── Core function ─────────────────────────────────────────────────────────────

/// Generate a fast, low-quality proxy MP4 from the current captured frames.
///
/// The proxy is encoded with the `ultrafast` H.264 preset at a reduced
/// resolution so the editor can load it for immediate playback.
///
/// `session_folder` – path to the session folder where `proxy.mp4` is written.
pub fn generate_proxy(
    frames: &[RawFrame],
    click_events: &[ClickEvent],
    session_capture: &SessionCaptureConfig,
    target_fps: u32,
    session_duration_ms: u128,
    session_folder: &str,
) -> Result<GeneratePreviewProxyResponse, String> {
    if frames.is_empty() {
        return Err("no captured frames available for proxy generation".to_string());
    }

    let proxy_path = PathBuf::from(session_folder).join("proxy.mp4");

    // Default profile – zoom is not applied in the proxy (keep it fast).
    let profile = ZoomProfile {
        zoom_in_ms: 0,
        hold_ms: 0,
        zoom_out_ms: 0,
        max_zoom: 1.0,
        easing: "none".to_string(),
    };

    // Use a smaller output resolution and the fastest preset for speed.
    let (frames_exported, _src_w, _src_h) = run_export(
        frames,
        click_events,
        session_capture,
        target_fps,
        session_duration_ms,
        &profile,
        &proxy_path,
        "1280:720",
        "ultrafast",
    )?;

    let fps = target_fps.max(1);
    let duration_ms = ((frames_exported.saturating_sub(1) as u128) * 1000) / fps as u128;

    Ok(GeneratePreviewProxyResponse {
        proxy_path: proxy_path.to_string_lossy().to_string(),
        duration_ms,
        width: 1280,
        height: 720,
        target_fps: fps,
    })
}


