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
pub mod capture;
pub mod export;
pub mod preview;
pub mod project;
pub mod render;
pub mod timeline;

use app::commands::{
    build_zoom_preview, export_recording_cmd, generate_preview_proxy, get_audio_status,
    get_click_timeline, get_frame_timeline, get_last_session_summary, get_recording_status,
    initialize_gpu_renderer, list_displays, set_audio_config, start_recording, stop_recording,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app::state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            get_recording_status,
            list_displays,
            get_click_timeline,
            get_last_session_summary,
            get_frame_timeline,
            initialize_gpu_renderer,
            build_zoom_preview,
            export_recording_cmd,
            generate_preview_proxy,
            get_audio_status,
            set_audio_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
