use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInitStatus {
    pub initialized: bool,
    pub adapter_name: Option<String>,
    pub backend: Option<String>,
}

#[derive(Debug, Default)]
pub struct GpuRendererState {
    pub initialized: bool,
    pub adapter_name: Option<String>,
    pub backend: Option<String>,
}

pub fn backend_name(backend: wgpu::Backend) -> String {
    match backend {
        wgpu::Backend::Vulkan => "vulkan".to_string(),
        wgpu::Backend::Metal => "metal".to_string(),
        wgpu::Backend::Dx12 => "dx12".to_string(),
        wgpu::Backend::Gl => "opengl".to_string(),
        wgpu::Backend::BrowserWebGpu => "webgpu".to_string(),
        wgpu::Backend::Noop => "noop".to_string(),
    }
}
