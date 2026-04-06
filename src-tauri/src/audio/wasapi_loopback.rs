// WASAPI loopback capture
//
// Captures whatever the system is playing (system audio) using the Windows
// Audio Session API loopback mode.  No virtual cable or extra software needed.
//
// Architecture:
//   - Spawned as a background thread at recording start.
//   - Writes a 32-bit float WAV file to `output_path`.
//   - Stops cleanly when `stop_signal` is set.
//   - The WAV is later muxed into source.mp4 by FFmpeg at stop time.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

/// Start a WASAPI loopback capture thread.
/// Returns None if no render device is available or on non-Windows platforms.
pub fn start_loopback_capture(
    output_path: PathBuf,
    stop_signal: Arc<AtomicBool>,
) -> Option<JoinHandle<()>> {
    #[cfg(target_os = "windows")]
    {
        Some(thread::spawn(move || {
            if let Err(e) = capture_thread(output_path, stop_signal) {
                eprintln!("[wasapi_loopback] capture failed: {e}");
            }
        }))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (output_path, stop_signal);
        None
    }
}

/// Returns true if a default audio render endpoint exists.
pub fn is_loopback_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        probe_default_render_device().is_ok()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

// ── Windows implementation ────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn probe_default_render_device() -> Result<(), String> {
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| e.to_string())?;
        enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn capture_thread(output_path: PathBuf, stop_signal: Arc<AtomicBool>) -> Result<(), String> {
    use std::slice;
    // Wave format tags not exported from the windows crate at this version.
    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
        MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    // COM must be initialised on the capture thread.
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok() };

    let result = (|| -> Result<(), String> {
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("CoCreateInstance IMMDeviceEnumerator: {e}"))?;

            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?;

            let client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate IAudioClient: {e}"))?;

            // GetMixFormat returns a heap-allocated WAVEFORMATEX; caller must CoTaskMemFree it.
            let fmt_ptr = client
                .GetMixFormat()
                .map_err(|e| format!("GetMixFormat: {e}"))?;
            let fmt = &*fmt_ptr;

            let channels = fmt.nChannels;
            let sample_rate = fmt.nSamplesPerSec;
            let is_float = fmt.wFormatTag == WAVE_FORMAT_IEEE_FLOAT
                || (fmt.wFormatTag == WAVE_FORMAT_EXTENSIBLE && fmt.wBitsPerSample == 32);

            // 200 ms buffer; silence during playback gaps still fills correctly.
            let buffer_duration_hns: i64 = 2_000_000;

            client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK,
                    buffer_duration_hns,
                    0,
                    fmt_ptr,
                    None,
                )
                .map_err(|e| format!("IAudioClient::Initialize: {e}"))?;

            let capture_client: IAudioCaptureClient = client
                .GetService()
                .map_err(|e| format!("GetService IAudioCaptureClient: {e}"))?;

            // Set up WAV writer (32-bit float, native channel count + sample rate).
            let spec = hound::WavSpec {
                channels,
                sample_rate,
                bits_per_sample: 32,
                sample_format: hound::SampleFormat::Float,
            };
            let mut writer = hound::WavWriter::create(&output_path, spec)
                .map_err(|e| format!("WavWriter::create: {e}"))?;

            client.Start().map_err(|e| format!("IAudioClient::Start: {e}"))?;

            while !stop_signal.load(Ordering::Relaxed) {
                let mut packet_size = capture_client
                    .GetNextPacketSize()
                    .unwrap_or(0);

                while packet_size > 0 {
                    let mut data_ptr = std::ptr::null_mut();
                    let mut frames_available = 0u32;
                    let mut flags = 0u32;

                    if capture_client
                        .GetBuffer(
                            &mut data_ptr,
                            &mut frames_available,
                            &mut flags,
                            None,
                            None,
                        )
                        .is_ok()
                    {
                        if !data_ptr.is_null() && frames_available > 0 {
                            let sample_count =
                                frames_available as usize * channels as usize;

                            if is_float {
                                // Native float32 — write directly.
                                let samples = slice::from_raw_parts(
                                    data_ptr as *const f32,
                                    sample_count,
                                );
                                for &s in samples {
                                    let _ = writer.write_sample(s);
                                }
                            } else {
                                // Assume int16 — normalise to f32.
                                let samples = slice::from_raw_parts(
                                    data_ptr as *const i16,
                                    sample_count,
                                );
                                for &s in samples {
                                    let _ = writer.write_sample(s as f32 / 32768.0_f32);
                                }
                            }
                        }

                        let _ = capture_client.ReleaseBuffer(frames_available);
                    }

                    packet_size = capture_client.GetNextPacketSize().unwrap_or(0);
                }

                std::thread::sleep(std::time::Duration::from_millis(10));
            }

            client.Stop().ok();
            writer.finalize().map_err(|e| format!("WavWriter::finalize: {e}"))?;
            Ok(())
        }
    })();

    unsafe { CoUninitialize() };
    result
}
