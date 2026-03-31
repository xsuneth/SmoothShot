// WASAPI loopback capture stub
//
// Real implementation will use the `windows` crate with the
// Windows.Media.Capture / IAudioClient / IAudioCaptureClient APIs.
//
// Planned Phase 4 feature (see SMOOTHSHOT_SCREEN_STUDIO_PLAN.md).

/// Returns `true` if a WASAPI loopback device appears to be available.
/// Currently always returns `false` until the real implementation lands.
///
/// TODO: When the WASAPI backend is implemented, query `IMMDeviceEnumerator`
/// for a default render endpoint and return `true` if one exists.
#[allow(dead_code)]
pub fn is_loopback_available() -> bool {
    false
}
