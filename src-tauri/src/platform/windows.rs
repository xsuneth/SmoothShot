// Windows-specific platform helpers
//
// Uses raw-window-handle 0.6 to extract the HWND as an isize so we avoid
// any windows-crate version conflicts with Tauri's own internals.

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
};

/// Make the given window invisible to all screen-capture APIs (DXGI,
/// BitBlt, WGC) while keeping it fully visible to the user.
///
/// Requires Windows 10 Build 19041 (version 2004) or later.
/// Silently no-ops on older builds.
pub fn apply_capture_exclusion(window: &tauri::WebviewWindow) {
    let hwnd = match get_hwnd(window) {
        Some(h) => h,
        None => return,
    };

    unsafe {
        // WDA_EXCLUDEFROMCAPTURE = 0x00000011
        // Ignoring the return value — failure is non-fatal (older Windows).
        let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
    }
}

fn get_hwnd(window: &tauri::WebviewWindow) -> Option<HWND> {
    let handle = window.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::Win32(h) => {
            let raw: isize = h.hwnd.get();
            Some(HWND(raw as *mut _))
        }
        _ => None,
    }
}
