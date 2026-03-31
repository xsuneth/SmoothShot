# SmoothShot Screen Studio Plan

## Goal

Build a Windows-first desktop app that reaches the same core editing feel as Screen Studio:

- smooth screen capture
- instant editor handoff after recording
- real preview before final export
- cinematic zoom/cursor/background styling
- low-latency timeline editing
- export output that matches the preview

This document describes:

- why preview currently only works after export
- current architectural gaps
- the recommended architecture
- the media pipelines
- the best library choices
- the execution plan

## Why Preview Currently Needs Export

Right now the app cannot behave like Screen Studio in the editor before export because the current architecture does not create a true playable source asset or a true preview render pipeline.

In the current codebase:

- screen capture is done with the `screenshots` crate in a CPU polling loop
- captured frames are stored in memory as raw RGBA in `Vec<RawFrame>`
- click events are stored separately in memory
- export is the only place where frames are actually transformed into a finished video stream
- the editor preview is a normal HTML video element that expects an existing video file

That means the app has:

- no persistent source recording file to play immediately in the editor
- no decoder/compositor pipeline that can preview edits directly from captured frames
- no shared preview/export render graph

So today the preview works only after export because export is the first time the app produces a real MP4 asset.

## Current Architectural Issues

These are the main blockers to true Screen Studio-level behavior.

### 1. Capture Backend Is CPU Screenshot Polling

Current state:

- `screenshots` captures full images on the CPU
- there is no true window capture backend
- there is no hardware-accelerated capture path

Problems:

- higher CPU cost
- weaker timing stability
- poorer scaling to long recordings
- harder to support window capture parity

### 2. Session Data Lives In Memory Only

Current state:

- raw RGBA frames are stored in RAM
- click metadata is stored in RAM
- no project/session asset bundle exists

Problems:

- large recordings will blow up memory usage
- editor state is not durable
- preview cannot attach to a stable media source

### 3. Preview And Export Are Different Systems

Current state:

- preview is a web video element plus UI mock rendering
- export is a Rust CPU transform pipeline feeding FFmpeg

Problems:

- preview cannot match final output exactly
- effects need to be implemented twice
- debugging visual mismatches becomes painful

### 4. GPU Exists But Is Not The Compositor Yet

Current state:

- `wgpu` initialization exists
- actual transform/render work is still CPU-side during export

Problems:

- no fast real-time compositing
- no true live preview of zoom/background/cursor effects
- no single graphics pipeline for preview and export

### 5. Audio Pipeline Is Missing

Current state:

- no real system audio capture
- no real mic capture pipeline
- no audio sync model

Problems:

- Screen Studio parity is impossible without synced audio
- timeline editing cannot behave like a proper media editor

### 6. No Real Project Model

Current state:

- the app mostly treats the session as an in-memory recording buffer
- editor settings are transient UI state

Problems:

- no saved edit sessions
- no reusable presets
- no proper timeline asset model

### 7. FFmpeg Dependency Is External And Late In The Pipeline

Current state:

- export depends on `ffmpeg` being present in PATH
- FFmpeg only appears at the end of the workflow

Problems:

- brittle install story
- no proxy/media pipeline around it
- no packaged production flow

## Recommended Target Architecture

The most efficient and smooth approach is:

1. capture once into a durable source asset
2. create a proxy or preview-ready source immediately
3. drive preview and export from the same edit graph
4. keep React as the control UI, not the render engine
5. move media processing authority into Rust

### High-Level System

```text
React/Tauri UI
  -> project state + commands

Rust Core
  -> capture backend
  -> asset/session manager
  -> timeline/edit graph
  -> preview compositor
  -> export renderer
  -> audio sync/mix

Platform Backends
  -> Windows Graphics Capture
  -> WASAPI loopback + microphone
  -> later: ScreenCaptureKit + AVFoundation on macOS

Encoding / Packaging
  -> bundled FFmpeg sidecar
```

### Design Rule

The preview and export pipelines must share the same effect graph:

- crop
- padding
- shadow
- rounded corners
- background
- zoom keyframes
- cursor styling
- click highlights

If preview and export use different implementations, SmoothShot will always feel inconsistent.

## Recommended Pipelines

## 1. Capture Pipeline

Target flow:

```text
Windows Graphics Capture
  -> GPU frame
  -> source recorder writes session asset to disk
  -> metadata recorder writes cursor/click/window/display data
  -> optional proxy encoder writes lightweight preview media
```

Recommended output after recording stops:

- `project.json`
- `source_video.*`
- `source_audio_system.*`
- `source_audio_mic.*`
- `cursor_events.json`
- `click_events.json`
- `proxy_video.*` optional but recommended
- `thumbnails/`

### Best Practical Approach

For SmoothShot, the best Windows-first approach is:

- record the original capture to disk immediately after capture, not just in RAM
- write metadata alongside it
- create a lightweight preview/proxy asset for instant editing

That gives:

- instant playable preview source
- bounded memory usage
- stable editor reopen behavior

## 2. Preview Pipeline

Target flow:

```text
source/proxy decode
  -> apply timeline graph
  -> GPU compositor
  -> preview surface
```

Preview should support:

- play/pause/seek
- trim in/out
- zoom markers
- background changes
- frame scale/padding
- cursor/click overlays

### Important Rule

The React layer should not be the thing that visually composes the video.

React should:

- send commands
- show controls
- reflect state

Rust should:

- decode frames
- composite frames
- own the render truth

## 3. Timeline Pipeline

Target flow:

```text
project session
  -> clip track
  -> effect tracks / keyframes
  -> cursor track
  -> zoom track
  -> audio tracks
```

Minimum model needed:

- one main captured clip
- trim in/out
- zoom markers with time and parameters
- background settings
- cursor styling settings
- export settings

Later model:

- keyframeable zoom strength
- multiple style presets
- transitions
- annotation overlays

## 4. Audio Pipeline

Target flow:

```text
WASAPI loopback + microphone
  -> resample to common rate
  -> drift correction
  -> preview mix
  -> export mix
```

Need:

- separate system audio track
- separate mic track
- mute/toggle/gain per source
- alignment and drift correction

Without this, Screen Studio parity is not realistic.

## 5. Export Pipeline

Target flow:

```text
source media + timeline graph
  -> render frames through same compositor as preview
  -> hand rendered frames/audio to bundled FFmpeg
  -> final MP4 output
```

Export should not be a one-off custom path that behaves differently from preview.

## Best Library / Technology Choices

These are the recommended choices for the current repo and target.

## Core App

- `tauri`
  - keep it for shell, commands, packaging, file dialogs, sidecars
- `serde`
  - keep for project/session serialization
- `wgpu`
  - keep and actually use it for compositing

## Windows Capture

- `windows` crate with `Windows.Graphics.Capture`
  - recommended primary Windows capture backend
  - better fit than CPU screenshot polling

Why:

- hardware-accelerated capture path
- proper window/display capture model
- better latency and stability

Official source:

- Microsoft Learn: Windows Graphics Capture
  - https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture

## Windows Audio

- `windows` crate for WASAPI loopback and mic capture

Why:

- system audio loopback needs native Windows support
- generic cross-platform audio crates are usually not enough for polished Windows loopback workflows

## GPU Render / Effects

- `wgpu`
  - use for preview compositor and export compositor
- `bytemuck`
  - helpful for buffer uploads and GPU data layout

Official sources:

- https://wgpu.rs/
- https://docs.rs/wgpu/

## Media Encode / Decode

Recommended near-term:

- bundle FFmpeg as a Tauri sidecar

Why:

- mature encoder/muxer stack
- avoids requiring PATH setup
- faster route to shipping

Official sources:

- FFmpeg documentation
  - https://ffmpeg.org/ffmpeg-doc.html
- FFmpeg filters
  - https://ffmpeg.org/ffmpeg-filters.html
- Tauri sidecars
  - https://tauri.app/develop/sidecar/

Recommended longer-term:

- keep FFmpeg as encode/decode infrastructure
- move effect rendering into Rust/wgpu before frames/audio are handed to FFmpeg

## Concurrency / Queues

Recommended:

- `crossbeam-channel` or `flume`
- `tokio` only if async orchestration becomes necessary across subsystems

Why:

- capture, preview decode, render, and export all need queue-based handoff

## Project Persistence

Recommended:

- JSON project file first
- stable asset folder structure

Do not start with a database unless there is a clear need.

## File Dialogs / User Media

Recommended:

- Tauri dialog APIs for file selection

## Future macOS Backend

Recommended:

- ScreenCaptureKit for display/window capture
- AVFoundation for audio / media integration
- bridge via `objc2` or a thin Swift helper if needed

Official source:

- Apple ScreenCaptureKit docs
  - https://developer.apple.com/documentation/screencapturekit/

## What To Avoid

Avoid these architectural traps:

- keeping full-session raw RGBA in RAM as the main source of truth
- building preview in HTML/CSS while export lives in Rust
- depending on manual FFmpeg installation in PATH
- trying to achieve Screen Studio parity with only CPU transforms
- mixing persistent media state and temporary UI state without a project model

## Feature Plan

## Phase 1: Recording Core Rebuild

Goal:

- move from proof-of-concept capture to a durable source pipeline

Deliverables:

- Windows Graphics Capture backend
- durable session folder written to disk
- source video asset generated after recording
- cursor and click metadata files
- project/session file

## Phase 2: Real Preview

Goal:

- editor can play immediately after recording without export

Deliverables:

- preview source asset or proxy asset
- timeline play/pause/seek
- preview surface driven by source media
- current-frame updates from timeline state

## Phase 3: Shared Render Graph

Goal:

- preview and export look the same

Deliverables:

- Rust effect graph
- GPU compositor with `wgpu`
- background, padding, scale, zoom, cursor overlay in one render path

## Phase 4: Audio

Goal:

- system audio + mic parity

Deliverables:

- WASAPI loopback capture
- microphone capture
- sync and drift handling
- gain/mute controls
- preview mix and export mix

## Phase 5: Timeline Editing

Goal:

- basic Screen Studio-style editing experience

Deliverables:

- clip trim handles
- draggable zoom blocks
- keyframe model
- presets
- timeline thumbnails / waveform / click markers

## Phase 6: Export Quality And Packaging

Goal:

- shippable output and install flow

Deliverables:

- bundled FFmpeg sidecar
- hardware-assisted encode where practical
- export presets
- project open/save/reopen

## Feature Checklist

## Must Have

- display capture
- window capture
- stable timing
- real editor preview before export
- background controls
- zoom keyframes
- click overlays
- cursor styling
- timeline trim and seek
- system audio + mic
- final export parity with preview

## Should Have

- proxy generation for smooth preview
- presets
- saveable projects
- waveform rendering
- thumbnails
- hardware encoding options

## Nice To Have

- multi-clip timeline
- annotations
- transitions
- branding kits
- preset marketplace

## Concrete First Build Order

If the goal is the fastest path to something that really feels like Screen Studio, the order should be:

1. replace `screenshots` capture with Windows Graphics Capture
2. write session assets to disk after recording
3. generate a playable source or proxy asset immediately
4. build real preview playback before touching more editor polish
5. move visual effects into a shared Rust/wgpu compositor
6. add audio capture and sync
7. only then deepen the timeline/editor interactions

That order is more efficient than continuing to polish the current UI shell, because the current shell sits on top of a media architecture that still cannot deliver real parity.

## Recommended Repo Direction

Suggested module split:

```text
src/
  components/
  hooks/
  state/
  types.ts

src-tauri/src/
  capture/
    windows_graphics_capture.rs
    macos_screencapturekit.rs
  audio/
    wasapi_loopback.rs
    mic_capture.rs
    sync.rs
  project/
    project_model.rs
    persistence.rs
  timeline/
    timeline_model.rs
    zoom_track.rs
  render/
    compositor.rs
    shaders/
  preview/
    preview_session.rs
  export/
    exporter.rs
    ffmpeg_sidecar.rs
  app/
    commands.rs
    state.rs
```

## Bottom Line

SmoothShot can absolutely reach Screen Studio-like ability on Windows, but not by extending the current proof-of-concept capture/export architecture as-is.

The key change is:

- stop treating export as the first real media product
- start treating the captured session as a real project with source assets, metadata, preview, and a shared render graph

That is the efficient, smooth, and scalable route.

## References

- Microsoft Windows Graphics Capture
  - https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture
- Apple ScreenCaptureKit
  - https://developer.apple.com/documentation/screencapturekit/
- wgpu
  - https://wgpu.rs/
  - https://docs.rs/wgpu/
- Tauri sidecar docs
  - https://tauri.app/develop/sidecar/
- FFmpeg docs
  - https://ffmpeg.org/ffmpeg-doc.html
  - https://ffmpeg.org/ffmpeg-filters.html
