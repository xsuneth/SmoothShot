// GPU compositor
//
// Owns the wgpu instance, adapter, and (eventually) the render pipeline used
// for both preview compositing and export rendering.
//
// Current state: initialisation and adapter query only.
// Planned Phase 3: full effect graph (background, padding, zoom, cursor overlay).

use pollster::block_on;
use serde::Serialize;

// ── Status type ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInitStatus {
    pub initialized: bool,
    pub adapter_name: Option<String>,
    pub backend: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/// Initialise the wgpu adapter and return status.
pub fn init_gpu() -> Result<GpuInitStatus, String> {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());

    let adapter = block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
    }))
    .map_err(|err| format!("failed to find GPU adapter: {err}"))?;

    let info = adapter.get_info();
    Ok(GpuInitStatus {
        initialized: true,
        adapter_name: Some(info.name.clone()),
        backend: Some(backend_name(info.backend)),
    })
}

// ── Per-pixel helpers used by the CPU export path ────────────────────────────

pub fn apply_zoom_transform_rgba(
    source: &[u8],
    width: u32,
    height: u32,
    zoom: f32,
    focus_x: i32,
    focus_y: i32,
) -> Vec<u8> {
    if zoom <= 1.001 {
        return source.to_vec();
    }

    let width_usize = width as usize;
    let height_usize = height as usize;
    let (crop_w, crop_h, x0, y0) = compute_zoom_window(width, height, zoom, focus_x, focus_y);

    let mut output = vec![0_u8; source.len()];

    for y in 0..height_usize {
        for x in 0..width_usize {
            let sx = x0 + (((x as f32) / (width as f32)) * crop_w as f32).floor() as u32;
            let sy = y0 + (((y as f32) / (height as f32)) * crop_h as f32).floor() as u32;

            let sx = sx.min(width.saturating_sub(1));
            let sy = sy.min(height.saturating_sub(1));

            let src_offset = ((sy as usize * width_usize) + sx as usize) * 4;
            let dst_offset = ((y * width_usize) + x) * 4;
            output[dst_offset..dst_offset + 4]
                .copy_from_slice(&source[src_offset..src_offset + 4]);
        }
    }

    output
}

pub fn compute_zoom_window(
    width: u32,
    height: u32,
    zoom: f32,
    focus_x: i32,
    focus_y: i32,
) -> (u32, u32, u32, u32) {
    let crop_w = ((width as f32) / zoom).round().max(1.0) as u32;
    let crop_h = ((height as f32) / zoom).round().max(1.0) as u32;

    let max_x0 = width.saturating_sub(crop_w) as i32;
    let max_y0 = height.saturating_sub(crop_h) as i32;
    let x0 = (focus_x - (crop_w as i32 / 2)).clamp(0, max_x0) as u32;
    let y0 = (focus_y - (crop_h as i32 / 2)).clamp(0, max_y0) as u32;

    (crop_w, crop_h, x0, y0)
}

pub fn map_point_through_zoom(
    width: u32,
    height: u32,
    zoom: f32,
    focus_x: i32,
    focus_y: i32,
    point_x: i32,
    point_y: i32,
) -> (i32, i32) {
    if zoom <= 1.001 {
        return (
            point_x.clamp(0, width.saturating_sub(1) as i32),
            point_y.clamp(0, height.saturating_sub(1) as i32),
        );
    }

    let (crop_w, crop_h, x0, y0) = compute_zoom_window(width, height, zoom, focus_x, focus_y);

    let local_x = (point_x - x0 as i32).clamp(0, crop_w.saturating_sub(1) as i32);
    let local_y = (point_y - y0 as i32).clamp(0, crop_h.saturating_sub(1) as i32);

    let mapped_x = ((local_x as f32 / crop_w.max(1) as f32) * width as f32).round() as i32;
    let mapped_y = ((local_y as f32 / crop_h.max(1) as f32) * height as f32).round() as i32;

    (
        mapped_x.clamp(0, width.saturating_sub(1) as i32),
        mapped_y.clamp(0, height.saturating_sub(1) as i32),
    )
}

pub fn blend_frames_rgba(left: &[u8], right: &[u8], blend: f32) -> Vec<u8> {
    if blend <= 0.001 {
        return left.to_vec();
    }

    if blend >= 0.999 {
        return right.to_vec();
    }

    let inv = 1.0 - blend;
    let mut out = vec![0_u8; left.len()];
    for i in 0..left.len() {
        out[i] = (left[i] as f32 * inv + right[i] as f32 * blend).round() as u8;
    }
    out
}

pub fn blend_pixel_rgba(dst: &mut [u8], offset: usize, color: [u8; 4]) {
    let alpha = color[3] as f32 / 255.0;
    let inv = 1.0 - alpha;
    dst[offset] = (dst[offset] as f32 * inv + color[0] as f32 * alpha) as u8;
    dst[offset + 1] = (dst[offset + 1] as f32 * inv + color[1] as f32 * alpha) as u8;
    dst[offset + 2] = (dst[offset + 2] as f32 * inv + color[2] as f32 * alpha) as u8;
    dst[offset + 3] = 255;
}

pub fn draw_ring_rgba(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    center_x: i32,
    center_y: i32,
    radius: i32,
    thickness: i32,
    color: [u8; 4],
) {
    let width_i32 = width as i32;
    let height_i32 = height as i32;
    let min_x = (center_x - radius - thickness).clamp(0, width_i32.saturating_sub(1));
    let max_x = (center_x + radius + thickness).clamp(0, width_i32.saturating_sub(1));
    let min_y = (center_y - radius - thickness).clamp(0, height_i32.saturating_sub(1));
    let max_y = (center_y + radius + thickness).clamp(0, height_i32.saturating_sub(1));

    let inner = (radius - thickness).max(0);
    let outer = radius + thickness;
    let inner_sq = inner * inner;
    let outer_sq = outer * outer;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let dx = x - center_x;
            let dy = y - center_y;
            let dist_sq = dx * dx + dy * dy;
            if dist_sq >= inner_sq && dist_sq <= outer_sq {
                let offset = ((y as usize * width as usize) + x as usize) * 4;
                blend_pixel_rgba(pixels, offset, color);
            }
        }
    }
}

pub fn draw_filled_circle_rgba(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    center_x: i32,
    center_y: i32,
    radius: i32,
    color: [u8; 4],
) {
    let width_i32 = width as i32;
    let height_i32 = height as i32;
    let min_x = (center_x - radius).clamp(0, width_i32.saturating_sub(1));
    let max_x = (center_x + radius).clamp(0, width_i32.saturating_sub(1));
    let min_y = (center_y - radius).clamp(0, height_i32.saturating_sub(1));
    let max_y = (center_y + radius).clamp(0, height_i32.saturating_sub(1));
    let radius_sq = radius * radius;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let dx = x - center_x;
            let dy = y - center_y;
            if dx * dx + dy * dy <= radius_sq {
                let offset = ((y as usize * width as usize) + x as usize) * 4;
                blend_pixel_rgba(pixels, offset, color);
            }
        }
    }
}

pub fn draw_cursor_overlay_rgba(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    cursor_x: i32,
    cursor_y: i32,
    timestamp_ms: u128,
    click_events_local: &[(u128, i32, i32)],
) {
    draw_filled_circle_rgba(
        pixels,
        width,
        height,
        cursor_x,
        cursor_y,
        6,
        [36, 206, 229, 255],
    );
    draw_ring_rgba(
        pixels,
        width,
        height,
        cursor_x,
        cursor_y,
        9,
        2,
        [255, 255, 255, 220],
    );

    for (click_time, click_x, click_y) in click_events_local {
        if timestamp_ms < *click_time || timestamp_ms > (*click_time + 340) {
            continue;
        }

        let progress = (timestamp_ms - *click_time) as f32 / 340.0;
        let radius = (12.0 + (20.0 * progress)).round() as i32;
        let alpha = (220.0 * (1.0 - progress))
            .round()
            .clamp(0.0, 255.0) as u8;
        draw_ring_rgba(
            pixels,
            width,
            height,
            *click_x,
            *click_y,
            radius,
            2,
            [255, 202, 51, alpha],
        );
    }
}
