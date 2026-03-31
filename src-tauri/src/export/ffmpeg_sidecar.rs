// FFmpeg sidecar / detection utilities
//
// Provides helpers for locating a bundled FFmpeg binary (Tauri sidecar) or
// falling back to a system-PATH installation.
//
// Planned Phase 6: bundle FFmpeg as a proper Tauri sidecar so that no manual
// installation is required.  See: https://tauri.app/develop/sidecar/

use std::path::PathBuf;
use std::process::{Command, Stdio};

/// Attempt to locate an FFmpeg binary.
///
/// Resolution order:
/// 1. `ffmpeg` or `ffmpeg.exe` adjacent to the current executable (sidecar).
/// 2. `ffmpeg` found via `PATH`.
///
/// Returns the path if found, or an error string if FFmpeg is unavailable.
pub fn resolve_ffmpeg() -> Result<PathBuf, String> {
    // 1. Check for a bundled sidecar next to the executable.
    if let Ok(exe_dir) = std::env::current_exe()
        .map(|p| p.parent().map(|d| d.to_path_buf()).unwrap_or_default())
    {
        let sidecar_name = if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        };
        let candidate = exe_dir.join(sidecar_name);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    // 2. Fall back to PATH.
    let probe = Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    match probe {
        Ok(_) => Ok(PathBuf::from("ffmpeg")),
        Err(_) => Err(
            "FFmpeg was not found. Install FFmpeg and ensure it is on your PATH, \
             or place a bundled ffmpeg binary next to the SmoothShot executable."
                .to_string(),
        ),
    }
}

/// Returns `true` if FFmpeg can be located.
pub fn ffmpeg_available() -> bool {
    resolve_ffmpeg().is_ok()
}
