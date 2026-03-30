# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning while in pre-1.0 milestones.

## [Unreleased]
### Added
- v0.2 backend command to initialize a wgpu adapter for GPU rendering path readiness.
- v0.2 cinematic auto-zoom timeline engine with ease-in-out profile generation from click events.
- v0.2 UI controls for GPU initialization and zoom preview inspection.
- v0.3 backend MP4 export implementation using FFmpeg with H.264 encoding and 1080p scaling.
- v0.3 export path now applies click-driven zoom transforms before encoding.
- v0.3 UI now displays export path and output metadata after completion.
- v0.4 basic in-app preview player for exported MP4 files.

### Changed
- Export timing now aligns to real session duration to avoid accelerated playback.
- Export output metadata now includes computed output duration.

## [0.1.0] - 2026-03-31
### Added
- Bootstrapped Tauri v2 + React + TypeScript project using pnpm.
- Added Rust recording foundation with start/stop/status commands.
- Added frame capture loop foundation using screenshots crate with target FPS configuration.
- Added cursor coordinate and click event timeline collection.
- Added minimal MVP UI with Start Recording, Stop Recording, and Export controls.
- Added CI workflows for Windows (required) and macOS (advisory).

### Notes
- Export is intentionally deferred to v0.3.0 (FFmpeg integration).
- GPU zoom pipeline is intentionally deferred to v0.2.0.
