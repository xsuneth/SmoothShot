// Preview session
//
// Placeholder for proxy generation. The full implementation requires a
// `run_export` function that does not yet exist in the export module.
// The `generate_preview_proxy` command returns an error until this is ready.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePreviewProxyResponse {
    pub proxy_path: String,
    pub duration_ms: u128,
    pub width: u32,
    pub height: u32,
    pub target_fps: u32,
}

pub fn generate_proxy() -> Result<GeneratePreviewProxyResponse, String> {
    Err("Preview proxy generation is not yet implemented".to_string())
}
