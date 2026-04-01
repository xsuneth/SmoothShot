use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::app::state::ClickEvent;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorEventRecord {
    pub timestamp_ms: u128,
    pub cursor_x: i32,
    pub cursor_y: i32,
}

pub fn save_project_folder(folder: &Path) -> Result<(), String> {
    fs::create_dir_all(folder)
        .map_err(|err| format!("failed to create project folder: {err}"))
}

pub fn load_click_events(folder: &Path) -> Result<Vec<ClickEvent>, String> {
    let path = folder.join("click_events.json");
    let data = fs::read_to_string(&path)
        .map_err(|err| format!("failed to read click_events.json: {err}"))?;
    serde_json::from_str(&data)
        .map_err(|err| format!("failed to parse click_events.json: {err}"))
}

pub fn load_cursor_events(folder: &Path) -> Result<Vec<CursorEventRecord>, String> {
    let path = folder.join("cursor_events.json");
    let data = fs::read_to_string(&path)
        .map_err(|err| format!("failed to read cursor_events.json: {err}"))?;
    serde_json::from_str(&data)
        .map_err(|err| format!("failed to parse cursor_events.json: {err}"))
}

fn write_json<T: Serialize + ?Sized>(folder: &Path, file_name: &str, value: &T) -> Result<(), String> {
    let path = folder.join(file_name);
    let json = serde_json::to_string_pretty(value)
        .map_err(|err| format!("failed to serialize {file_name}: {err}"))?;
    fs::write(&path, json)
        .map_err(|err| format!("failed to write {file_name}: {err}"))
}

pub fn save_click_events(folder: &Path, events: &[ClickEvent]) -> Result<(), String> {
    write_json(folder, "click_events.json", events)
}

pub fn save_cursor_events(folder: &Path, events: &[CursorEventRecord]) -> Result<(), String> {
    write_json(folder, "cursor_events.json", events)
}
