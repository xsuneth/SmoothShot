use std::io::Write;
use std::process::{Child, Command, Stdio};

use crate::export::ffmpeg_sidecar::resolve_ffmpeg;

// ── Camera recording via FFmpeg DirectShow ───────────────────────────────────

/// Records camera video to an MP4 file using FFmpeg with DirectShow input.
/// The preview is handled entirely by the browser's getUserMedia API.
pub struct CameraRecording {
    child: Child,
    output_path: String,
}

impl CameraRecording {
    /// Start recording from the named DirectShow camera device to the given path.
    pub fn start(camera_device: &str, output_path: &str) -> Result<Self, String> {
        let ffmpeg = resolve_ffmpeg()?;
        let mut cmd = Command::new(ffmpeg);

        cmd.arg("-y")
            // DirectShow video input
            .arg("-f")
            .arg("dshow")
            .arg("-rtbufsize")
            .arg("100M")
            .arg("-i")
            .arg(format!("video={camera_device}"))
            // Fast encoding for real-time capture
            .arg("-c:v")
            .arg("libx264")
            .arg("-preset")
            .arg("ultrafast")
            .arg("-tune")
            .arg("zerolatency")
            .arg("-crf")
            .arg("18")
            .arg("-pix_fmt")
            .arg("yuv420p")
            .arg(output_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let child = cmd
            .spawn()
            .map_err(|e| format!("failed to start camera recording: {e}"))?;

        Ok(Self {
            child,
            output_path: output_path.to_string(),
        })
    }

    /// Gracefully stop the recording by sending 'q' to FFmpeg's stdin.
    pub fn stop(&mut self) -> Result<String, String> {
        if let Some(mut stdin) = self.child.stdin.take() {
            let _ = stdin.write_all(b"q\n");
        }
        let _ = self
            .child
            .wait()
            .map_err(|e| format!("failed to wait for camera ffmpeg: {e}"))?;
        Ok(self.output_path.clone())
    }
}
