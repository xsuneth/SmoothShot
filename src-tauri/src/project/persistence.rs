// Project persistence helpers
//
// Functions for creating the session folder on disk and writing the various
// JSON metadata files that make up a SmoothShot project.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::capture::ClickEvent;
use crate::project::project_model::{CursorEventRecord, ProjectFile};

fn normalize_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        use std::path::Path;

        let raw = path.to_string_lossy().to_string();
        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return Path::new(stripped).to_path_buf();
        }
    }

    path
}

/// Build the canonical session folder path for the given epoch.
pub fn session_folder_path(epoch: u64) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push("smoothshot");
    path.push("sessions");
    path.push(format!("session-{epoch}"));
    path
}

/// Create (or confirm the existence of) the session folder.
pub fn create_session_folder(epoch: u64) -> Result<PathBuf, String> {
    let folder = session_folder_path(epoch);
    fs::create_dir_all(&folder).map_err(|err| format!("failed to create session folder: {err}"))?;
    let canonical = fs::canonicalize(&folder).unwrap_or(folder);
    Ok(normalize_path(canonical))
}

/// Serialise a value and write it to a JSON file inside `folder`.
fn write_json<T: Serialize + ?Sized>(
    folder: &Path,
    file_name: &str,
    value: &T,
) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|err| format!("failed to serialise {file_name}: {err}"))?;
    let path = folder.join(file_name);
    fs::write(&path, json).map_err(|err| format!("failed to write {file_name}: {err}"))?;
    Ok(())
}

/// Write `project.json` to the session folder.
pub fn write_project_file(folder: &Path, project: &ProjectFile) -> Result<(), String> {
    write_json(folder, "project.json", project)
}

/// Write `click_events.json` to the session folder.
pub fn write_click_events(folder: &Path, events: &[ClickEvent]) -> Result<(), String> {
    write_json(folder, "click_events.json", events)
}

/// Write `cursor_events.json` to the session folder.
pub fn write_cursor_events(folder: &Path, events: &[CursorEventRecord]) -> Result<(), String> {
    write_json(folder, "cursor_events.json", events)
}

/// Persist all session metadata into an existing session folder.
pub fn persist_session_in_folder(
    folder: &Path,
    project: &ProjectFile,
    click_events: &[ClickEvent],
    cursor_events: &[CursorEventRecord],
) -> Result<String, String> {
    fs::create_dir_all(folder).map_err(|err| format!("failed to create session folder: {err}"))?;
    write_project_file(folder, project)?;
    write_click_events(folder, click_events)?;
    write_cursor_events(folder, cursor_events)?;
    let canonical = fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
    Ok(normalize_path(canonical).to_string_lossy().to_string())
}

/// Persist all session metadata to disk.  Returns the folder path as a string.
///
/// * Writes `project.json`, `click_events.json`, and `cursor_events.json`.
/// * Does **not** write video assets; those are handled by the exporter /
///   preview subsystems.
pub fn persist_session(
    epoch: u64,
    project: &ProjectFile,
    click_events: &[ClickEvent],
    cursor_events: &[CursorEventRecord],
) -> Result<String, String> {
    let folder = create_session_folder(epoch)?;
    persist_session_in_folder(&folder, project, click_events, cursor_events)
}
