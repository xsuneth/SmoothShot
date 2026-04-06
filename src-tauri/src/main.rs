// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Auto-grant camera/microphone permissions in WebView2 without showing
    // the browser-style permission dialog. This must be set BEFORE the
    // WebView2 environment is created (i.e. before tauri::Builder::run).
    #[cfg(target_os = "windows")]
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--use-fake-ui-for-media-stream",
    );

    smoothshot_lib::run()
}
