#[cfg(target_os = "windows")]
pub mod windows;

/// Apply screen-capture exclusion to a Tauri window so it is invisible to
/// Windows capture APIs and any other capture path while remaining visible to
/// the user.
/// No-op on platforms that don't support it.
pub fn exclude_window_from_capture(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    windows::apply_capture_exclusion(window);

    #[cfg(not(target_os = "windows"))]
    let _ = window;
}
