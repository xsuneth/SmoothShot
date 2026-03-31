// Timeline zoom track
//
// Provides the zoom-animation data types and the easing / interpolation maths
// shared by both the preview compositor and the export renderer.

use serde::{Deserialize, Serialize};

// ── Zoom profile ──────────────────────────────────────────────────────────────

/// Animation profile that controls how a single zoom event plays out.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomProfile {
    pub zoom_in_ms: u128,
    pub hold_ms: u128,
    pub zoom_out_ms: u128,
    pub max_zoom: f32,
    pub easing: String,
}

impl Default for ZoomProfile {
    fn default() -> Self {
        Self {
            zoom_in_ms: 180,
            hold_ms: 120,
            zoom_out_ms: 260,
            max_zoom: 1.85,
            easing: "ease-in-out-sine".to_string(),
        }
    }
}

// ── Keyframe (user-positioned zoom marker) ────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomKeyframe {
    pub id: String,
    /// Position on the timeline.
    pub time_ms: u128,
    pub max_zoom: f32,
    pub focus_x: i32,
    pub focus_y: i32,
    pub zoom_in_ms: u128,
    pub hold_ms: u128,
    pub zoom_out_ms: u128,
}

// ── Per-frame transform (computed) ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomTransformFrame {
    pub frame_index: u64,
    pub timestamp_ms: u128,
    pub zoom: f32,
    pub focus_x: i32,
    pub focus_y: i32,
    pub click_driven: bool,
}

// ── Preview request / response ────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomPreviewRequest {
    pub limit: Option<usize>,
    pub zoom_in_ms: Option<u128>,
    pub hold_ms: Option<u128>,
    pub zoom_out_ms: Option<u128>,
    pub max_zoom: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomPreviewResponse {
    pub frames: Vec<ZoomTransformFrame>,
    pub click_count: usize,
    pub profile: ZoomProfile,
}

// ── Easing maths ──────────────────────────────────────────────────────────────

pub fn ease_in_out_sine(progress: f32) -> f32 {
    -((std::f32::consts::PI * progress).cos() - 1.0) / 2.0
}

/// Compute the zoom multiplier for a single frame given one click event.
///
/// Returns `None` when the frame falls outside the click's animation window.
pub fn zoom_from_click(
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
        let in_progress = (frame_timestamp_ms - click_timestamp_ms) as f32
            / profile.zoom_in_ms.max(1) as f32;
        return Some(min_zoom + zoom_span * ease_in_out_sine(in_progress.clamp(0.0, 1.0)));
    }

    if frame_timestamp_ms <= hold_end {
        return Some(profile.max_zoom);
    }

    let out_progress =
        (frame_timestamp_ms - hold_end) as f32 / profile.zoom_out_ms.max(1) as f32;
    Some(profile.max_zoom - zoom_span * ease_in_out_sine(out_progress.clamp(0.0, 1.0)))
}
