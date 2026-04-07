// SmoothShot library root
//
// Module layout (mirrors SMOOTHSHOT_SCREEN_STUDIO_PLAN.md):
//
//   capture/   – frame capture loop and raw data types
//   audio/     – audio pipeline (WASAPI loopback + mic stubs)
//   project/   – project model and disk persistence
//   timeline/  – timeline, trim, and zoom-track data
//   render/    – GPU compositor (wgpu) and CPU compositing helpers
//   preview/   – proxy generation for instant editor preview
//   export/    – FFmpeg sidecar detection and high-quality export
//   app/       – shared AppState and all Tauri command handlers

pub mod app;
pub mod audio;
pub mod camera;
pub mod capture;
pub mod export;
pub mod platform;
pub mod preview;
pub mod project;
pub mod render;
pub mod timeline;

use app::commands::{
    append_camera_chunk, build_zoom_preview, delete_recording, export_recording_cmd,
    generate_preview_proxy, get_audio_status, get_camera_url, get_click_timeline,
    get_frame_timeline, get_last_session_summary, get_preview_frame, get_recording_status,
    hide_countdown, initialize_gpu_renderer, list_camera_devices, list_displays,
    list_microphone_devices, mark_window_excluded, pause_recording, resume_recording,
    set_audio_config, set_camera_video_path, show_countdown_on_display, start_recording,
    stop_recording,
};

/// Position the launcher window at bottom-center of the primary monitor.
/// This runs in the Rust setup hook before any JS executes, preventing
/// any OS-level saved position from ever being displayed.
fn position_launcher_at_startup(app: &tauri::App) {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else { return };

    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());

    let Some(monitor) = monitor else { return };

    let scale = monitor.scale_factor();
    let screen = monitor.size();
    let origin = monitor.position();

    let win_size = match window.inner_size() {
        Ok(s) => s,
        Err(_) => return,
    };

    // 70 logical px above the taskbar, converted to physical pixels.
    let bottom_margin = (70.0 * scale) as i32;
    let x = origin.x + (screen.width as i32 - win_size.width as i32) / 2;
    let y = origin.y + screen.height as i32 - win_size.height as i32 - bottom_margin;

    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app::state::AppState::default())
        .setup(|app| {
            position_launcher_at_startup(app);

            // Exclude static app windows from all screen-capture APIs.
            use tauri::Manager;
            for label in &["main", "editor", "camera-preview", "countdown"] {
                if let Some(window) = app.get_webview_window(label) {
                    platform::exclude_window_from_capture(&window);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            pause_recording,
            resume_recording,
            delete_recording,
            get_recording_status,
            list_displays,
            list_camera_devices,
            list_microphone_devices,
            get_click_timeline,
            get_last_session_summary,
            get_frame_timeline,
            get_preview_frame,
            initialize_gpu_renderer,
            build_zoom_preview,
            export_recording_cmd,
            generate_preview_proxy,
            get_audio_status,
            set_audio_config,
            mark_window_excluded,
            get_camera_url,
            append_camera_chunk,
            set_camera_video_path,
            show_countdown_on_display,
            hide_countdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
