// Timeline model
//
// Represents the logical editing timeline for a single recorded session.

use serde::{Deserialize, Serialize};

use crate::timeline::zoom_track::ZoomKeyframe;

// ── Trim ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipTrim {
    pub start_ms: u128,
    pub end_ms: u128,
}

// ── Timeline ──────────────────────────────────────────────────────────────────

/// The main editing model for one recording session.
///
/// A `TimelineModel` is the source of truth for trim points, zoom keyframes,
/// and any future effect tracks.  It can be serialised alongside the project
/// file to allow sessions to be reopened.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineModel {
    pub duration_ms: u128,
    pub trim: ClipTrim,
    pub zoom_keyframes: Vec<ZoomKeyframe>,
}

impl TimelineModel {
    pub fn new(duration_ms: u128) -> Self {
        Self {
            duration_ms,
            trim: ClipTrim {
                start_ms: 0,
                end_ms: duration_ms,
            },
            zoom_keyframes: Vec::new(),
        }
    }
}
