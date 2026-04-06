# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
bun install

# Run in dev mode (starts Vite + Tauri dev window)
bun run tauri dev

# Type-check frontend only
bun run typecheck

# Build frontend + Tauri binary
bun run build

# Check Rust code without building
cd src-tauri && cargo check
```

No test suite exists yet; `bun run typecheck` and `cargo check` are the primary static checks.

## Stack

- **Frontend**: React 19 + TypeScript, Tailwind CSS v4, Vite 7
- **Backend**: Tauri v2, Rust 2021 edition
- **Package manager**: bun
- **Git**: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.), branches `main` / `develop` / short-lived feature branches

An FFmpeg binary must be available (sidecar or PATH) — it is resolved by `src-tauri/src/export/ffmpeg_sidecar.rs` and is required for recording (capture loop pipes raw frames into FFmpeg) and export.

## Architecture

### Multi-window React app

A single Vite/React bundle powers all three Tauri windows. `src/App.tsx` inspects the current window label (via `src/apps/appUtils.ts`) and renders one of three root apps:

| Window label | Root component | Purpose |
|---|---|---|
| `main` | `LauncherApp` | Floating launcher bar — mode picker, device selectors, start/stop recording |
| `editor` | `EditorApp` | Full editor — preview, inspector, timeline, export |
| `display-picker` | `DisplayPickerApp` | Modal picker showing display thumbnails |

Cross-window communication uses Tauri events (`mic-level`, `smoothshot:display-picker-*`, `smoothshot:session-updated`) defined in `src/lib/constants.ts`.

### Frontend layers

```
src/
  apps/          # Root app components (LauncherApp, EditorApp, DisplayPickerApp) + appUtils.ts
  components/    # Presentational UI components (EditorWindow, LauncherWindow, etc.)
  hooks/         # All stateful logic as custom hooks
  lib/           # constants.ts, utils.ts, cn.ts
  types.ts       # Shared TypeScript types mirroring Rust structs
```

`LauncherApp` and `EditorApp` are pure orchestrators: they compose hooks and pass props down to window components. Business logic lives in hooks under `src/hooks/`.

### Rust backend

All modules are declared in `src-tauri/src/lib.rs`. Every Tauri command handler lives in `src-tauri/src/app/commands.rs` and delegates to the module that owns the logic.

```
src-tauri/src/
  app/
    commands.rs   # All #[tauri::command] functions
    state.rs      # AppState (single Mutex<RecorderInner>, gpu, audio config)
  capture/        # Frame capture loop; Windows uses DXGI ddagrab via FFmpeg, macOS uses screenshot polling
  audio/          # WASAPI loopback + mic capture (cpal), device enumeration
  project/        # Session folder creation, project.json + cursor/click JSON persistence
  timeline/       # Zoom track: click-driven easing model, ZoomTransformFrame generation
  render/         # wgpu GPU compositor stub (init_gpu)
  preview/        # Proxy MP4 generation (currently disabled; source video used directly)
  export/         # FFmpeg sidecar detection, high-quality MP4 export
```

### Shared runtime state (`AppState`)

`AppState` (in `src-tauri/src/app/state.rs`) is managed by Tauri and injected into every command. It holds:
- `recorder: Mutex<RecorderInner>` — recording thread handle, stop signal, in-memory frame/click buffers, session paths
- `gpu_renderer: Mutex<GpuRendererState>`
- `audio_config: Mutex<AudioConfig>`
- `mic_meter_stop/handle` — live mic level emitter thread

### Recording pipeline

1. `start_recording` spawns a background thread running `capture_loop`.
2. On Windows: FFmpeg ddagrab captures directly to `source.mp4` in the session folder; cursor/click events are polled separately at ≥120 Hz.
3. On macOS: screenshot polling writes RGBA frames to an FFmpeg stdin pipe; pixel data is NOT retained in `RawFrame.pixels_rgba` (left empty) to avoid memory pressure.
4. `stop_recording` signals the thread, joins it, persists `project.json` + `cursor_events.json` + `click_events.json` to the session folder.
5. The editor loads the session and plays back `source.mp4` directly for preview.

### Session folder layout

Sessions are written under the system temp directory at `smoothshot/<epoch>/`:
- `source.mp4` — raw captured video
- `project.json` — `ProjectFile` struct
- `cursor_events.json` — per-frame cursor positions
- `click_events.json` — click timestamps and coordinates

### TypeScript ↔ Rust contract

All Rust structs that cross the IPC boundary use `#[serde(rename_all = "camelCase")]`. The matching TypeScript types are in `src/types.ts`. Keep both in sync when adding or renaming fields.
