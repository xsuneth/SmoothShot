# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning while in pre-1.0 milestones.

## [Unreleased]
### Added
- v0.2 backend command to initialize a wgpu adapter for GPU rendering path readiness.
- v0.2 cinematic auto-zoom timeline engine with ease-in-out profile generation from click events.
- v0.2 UI controls for GPU initialization and zoom preview inspection.

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
