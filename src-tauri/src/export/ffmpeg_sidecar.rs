// FFmpeg sidecar / detection utilities
//
// Provides helpers for locating a bundled FFmpeg binary (Tauri sidecar) or
// falling back to a system-PATH installation.
//
// Planned Phase 6: bundle FFmpeg as a proper Tauri sidecar so that no manual
// installation is required.  See: https://tauri.app/develop/sidecar/

use std::path::{Path, PathBuf};
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
    if let Ok(exe_dir) =
        std::env::current_exe().map(|p| p.parent().map(|d| d.to_path_buf()).unwrap_or_default())
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

#[cfg(target_os = "windows")]
fn ffmpeg_supports_filter(ffmpeg: &Path, filter_name: &str) -> bool {
    let output = match Command::new(ffmpeg)
        .arg("-hide_banner")
        .arg("-h")
        .arg(format!("filter={filter_name}"))
        .output()
    {
        Ok(output) => output,
        Err(_) => return false,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}\n{stderr}").to_lowercase();

    if combined.contains(&format!("unknown filter '{filter_name}'")) {
        return false;
    }

    combined.contains(&format!("filter {filter_name}"))
}

#[cfg(target_os = "windows")]
fn ffmpeg_candidates_from_path() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join("ffmpeg.exe");
            if candidate.exists() {
                candidates.push(candidate);
            }
        }
    }

    candidates
}

/// Resolve FFmpeg for Windows screen capture and ensure gfxcapture support.
#[cfg(target_os = "windows")]
pub fn resolve_ffmpeg_for_windows_capture() -> Result<PathBuf, String> {
    let ffmpeg = resolve_ffmpeg()?;

    if ffmpeg_supports_filter(&ffmpeg, "gfxcapture") {
        return Ok(ffmpeg);
    }

    for candidate in ffmpeg_candidates_from_path() {
        if ffmpeg_supports_filter(&candidate, "gfxcapture") {
            return Ok(candidate);
        }
    }

    Err(
        "FFmpeg was found, but this build does not include the `gfxcapture` source required for Windows recording. Install a newer FFmpeg build with `gfxcapture` support (for example a recent full/nightly build), then ensure SmoothShot uses it from PATH or as a sidecar binary."
            .to_string(),
    )
}

/// Returns `true` if FFmpeg can be located.
pub fn ffmpeg_available() -> bool {
    resolve_ffmpeg().is_ok()
}
