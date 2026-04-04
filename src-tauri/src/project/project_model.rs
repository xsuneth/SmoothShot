// Project model
//
// Defines the data structures that describe a SmoothShot recording session /
// project.  A project folder contains:
//
//   project.json         – this struct, serialised
//   source_video.*       – original capture (planned, not yet written)
//   proxy_video.*        – lightweight preview asset
//   cursor_events.json   – continuous cursor-position track
//   click_events.json    – discrete mouse-button events

use serde::{Deserialize, Serialize};

/// Top-level descriptor for a SmoothShot project.
///
/// Written to `project.json` inside the session folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub version: u32,
    /// Unique identifier derived from the recording epoch.
    pub session_id: String,
    /// Wall-clock time at which recording started (Unix epoch, milliseconds).
    pub created_at_ms: u64,
    /// Recording duration in milliseconds.
    pub duration_ms: u128,
    pub target_fps: u32,
    pub frames_captured: usize,
    pub clicks_detected: usize,
    pub source_width: u32,
    pub source_height: u32,
    /// Relative path to the captured source video inside the session folder, if available.
    pub source_video: Option<String>,
    /// Relative path to proxy MP4 inside the session folder, if generated.
    pub proxy_video: Option<String>,
    /// Relative file name for cursor events.
    pub cursor_events_file: String,
    /// Relative file name for click events.
    pub click_events_file: String,
}

/// A single cursor-position sample written to `cursor_events.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorEventRecord {
    pub timestamp_ms: u128,
    pub x: i32,
    pub y: i32,
}
