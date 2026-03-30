# SmoothShot

SmoothShot is a desktop app for cinematic screen recording with cursor-aware zoom effects.

The project targets both Windows and macOS, with Windows as the primary quality gate for the MVP cycle.

## Stack

- Tauri v2
- Rust backend
- React + TypeScript frontend
- Planned for later MVP stages: wgpu transform pipeline, FFmpeg MP4 export

## MVP Versioning and Approval Flow

Development is intentionally staged. Each version is released as a candidate and waits for explicit approval before the next version starts.

- v0.1.0: recording and cursor telemetry foundation
- v0.2.0: GPU auto-zoom pipeline
- v0.3.0: FFmpeg MP4 (H.264, 1080p) export
- v0.4.0: stabilization and optional preview

## Current Version: v0.1.0 released, v0.2/v0.3 in progress on develop

Implemented in this milestone:

- Start/Stop recording flow
- Target FPS configuration (24-60)
- Full-screen capture or manual region capture coordinates
- Cursor position tracking tied to capture timeline
- Click event timeline collection
- Basic control UI with Start Recording, Stop Recording, and Export button

Deferred by design:

- Auto zoom rendering (v0.2.0)
- MP4 export (v0.3.0)

## v0.2 In-Progress on develop

- wgpu adapter initialization command is available.
- Cinematic zoom timeline preview generation is available using click events and easing.
- UI includes "Init GPU" and "Build Zoom Preview" controls for quick verification.

## v0.3 In-Progress on develop

- FFmpeg export command produces MP4 (H.264) output.
- Export scales output to 1080p and applies click-driven zoom transform before encoding.
- UI displays export file path, frame count, and output format metadata.

## v0.4 In-Progress on develop

- Export timing is stabilized against real session duration to avoid fast playback.
- UI includes a basic preview player for exported MP4 output.

## Run Locally

```bash
pnpm install
pnpm tauri dev
```

## Build Checks

```bash
pnpm typecheck
pnpm build
cd src-tauri
cargo check
```

## CI

- Required: Windows validation workflow
- Advisory: macOS validation workflow (non-blocking until stabilization)

## Git Standards

- Branches: main, develop, and short-lived feature branches
- Commit style: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
- Tags: `v0.x.0` for milestone releases, `v0.x.y` for fixes
