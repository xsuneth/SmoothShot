// Microphone capture stub
//
// Real implementation will use the `windows` crate (WASAPI) on Windows
// and AVFoundation on macOS.
//
// Planned Phase 4 feature (see SMOOTHSHOT_SCREEN_STUDIO_PLAN.md).

/// Returns `true` if a default microphone device appears to be available.
/// Currently always returns `false` until the real implementation lands.
///
/// TODO: When the microphone capture backend is implemented, query the
/// default capture endpoint (WASAPI on Windows, AVFoundation on macOS) and
/// return `true` if a suitable device is found.
#[allow(dead_code)]
pub fn is_mic_available() -> bool {
    false
}
