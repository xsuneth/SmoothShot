// Microphone capture
//
// Uses cpal (already present for metering) to capture the selected microphone
// and writes a 32-bit float WAV file that is later muxed into source.mp4.
//
// The cpal Stream on Windows/WASAPI is not Send, so we build it entirely
// inside the spawned thread using a channel to pass the init result back.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

/// Start recording from `device_name` (or the system default if None) into
/// `output_path`.  Stops when `stop_signal` is set.
/// Returns None if no input device is available.
pub fn start_mic_capture(
    device_name: Option<String>,
    output_path: PathBuf,
    stop_signal: Arc<AtomicBool>,
) -> Option<JoinHandle<()>> {
    // Probe whether a mic is available before spawning the thread.
    if !is_mic_available() {
        return None;
    }

    // Use a one-shot channel to confirm the stream started successfully.
    let (tx, rx) = std::sync::mpsc::channel::<bool>();

    let handle = thread::spawn(move || {
        let host = cpal::default_host();

        let device = if let Some(ref name) = device_name {
            let name_lower = name.to_ascii_lowercase();
            host.input_devices().ok().and_then(|mut iter| {
                iter.find(|d| {
                    d.name()
                        .map(|n| n.to_ascii_lowercase().contains(&name_lower))
                        .unwrap_or(false)
                })
            })
        } else {
            host.default_input_device()
        };

        let device = match device {
            Some(d) => d,
            None => {
                let _ = tx.send(false);
                return;
            }
        };

        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(_) => {
                let _ = tx.send(false);
                return;
            }
        };

        let channels = config.channels();
        let sample_rate = config.sample_rate().0;

        let spec = hound::WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };

        let writer = match hound::WavWriter::create(&output_path, spec) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[mic_capture] failed to create WAV file: {e}");
                let _ = tx.send(false);
                return;
            }
        };

        let writer_shared: Arc<Mutex<Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>>> =
            Arc::new(Mutex::new(Some(writer)));
        let writer_for_callback = Arc::clone(&writer_shared);
        let writer_for_finalize = Arc::clone(&writer_shared);

        let err_fn = |err: cpal::StreamError| {
            eprintln!("[mic_capture] stream error: {err}");
        };

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.config(),
                move |data: &[f32], _| {
                    if let Ok(mut guard) = writer_for_callback.lock() {
                        if let Some(ref mut w) = *guard {
                            for &s in data {
                                let _ = w.write_sample(s);
                            }
                        }
                    }
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.config(),
                move |data: &[i16], _| {
                    if let Ok(mut guard) = writer_for_callback.lock() {
                        if let Some(ref mut w) = *guard {
                            for &s in data {
                                let _ = w.write_sample(s as f32 / 32768.0_f32);
                            }
                        }
                    }
                },
                err_fn,
                None,
            ),
            _ => {
                let _ = tx.send(false);
                return;
            }
        };

        let stream = match stream {
            Ok(s) => s,
            Err(_) => {
                let _ = tx.send(false);
                return;
            }
        };

        if stream.play().is_err() {
            let _ = tx.send(false);
            return;
        }

        // Signal that startup succeeded.
        let _ = tx.send(true);

        // Keep the stream alive until stop signal fires.
        while !stop_signal.load(Ordering::Relaxed) {
            thread::sleep(std::time::Duration::from_millis(16));
        }

        // Drop the stream first to stop the callback.
        drop(stream);

        // Finalise the WAV file (scoped to drop guard before Arc drop).
        {
            let writer_opt = writer_for_finalize.lock().ok().and_then(|mut g| g.take());
            if let Some(writer) = writer_opt {
                if let Err(e) = writer.finalize() {
                    eprintln!("[mic_capture] WAV finalize error: {e}");
                }
            }
        }
    });

    // Wait briefly to confirm the stream started. If it failed, join the thread.
    match rx.recv_timeout(std::time::Duration::from_secs(3)) {
        Ok(true) => Some(handle),
        _ => {
            let _ = handle.join();
            None
        }
    }
}

/// Returns true if any cpal input device is available.
pub fn is_mic_available() -> bool {
    cpal::default_host().default_input_device().is_some()
}
