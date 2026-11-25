use crate::types::{BackendArgs, HistoryEntry, Settings};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";
const HISTORY_FILE: &str = "history.json";
const HISTORY_LIMIT: usize = 500;

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create app data dir: {e}"))?;
    Ok(dir)
}

pub fn default_download_dir() -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    Path::new(&home)
        .join("Downloads")
        .join("aio-dl")
        .display()
        .to_string()
}

pub fn default_settings() -> Settings {
    Settings {
        output_dir: default_download_dir(),
        max_concurrent: 2,
        retries: 10,
        aria2_connections: 8,
        cookie_file: None,
        cookie_browser: None,
        video_format: "bv*+ba/b".into(),
        audio_only: false,
        audio_format: "mp3".into(),
        video_container: "mp4".into(),
        spotify_format: "mp3".into(),
        spotify_bitrate: "auto".into(),
        extra_args: BackendArgs::default(),
        open_folder_on_complete: false,
        insecure_tls: false,
    }
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let serialized =
        serde_json::to_string_pretty(value).map_err(|e| format!("serialize failed: {e}"))?;
    // Write to a temp file first so a crash can't truncate the existing file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serialized).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}

pub fn load_settings(app: &AppHandle) -> Settings {
    let Ok(dir) = data_dir(app) else {
        return default_settings();
    };
    read_json::<Settings>(&dir.join(SETTINGS_FILE)).unwrap_or_else(default_settings)
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    if settings.output_dir.trim().is_empty() {
        return Err("Output directory cannot be empty.".into());
    }
    let dir = data_dir(app)?;
    std::fs::create_dir_all(&settings.output_dir).map_err(|e| {
        format!(
            "Cannot create output directory {}: {e}",
            settings.output_dir
        )
    })?;
    write_json(&dir.join(SETTINGS_FILE), settings)
}

pub fn load_history(app: &AppHandle) -> Vec<HistoryEntry> {
    let Ok(dir) = data_dir(app) else {
        return Vec::new();
    };
    read_json::<Vec<HistoryEntry>>(&dir.join(HISTORY_FILE)).unwrap_or_default()
}

pub fn append_history(app: &AppHandle, entry: HistoryEntry) -> Result<Vec<HistoryEntry>, String> {
    let dir = data_dir(app)?;
    let mut history = load_history(app);
    history.insert(0, entry);
    history.truncate(HISTORY_LIMIT);
    write_json(&dir.join(HISTORY_FILE), &history)?;
    Ok(history)
}

pub fn clear_history(app: &AppHandle) -> Result<(), String> {
    let dir = data_dir(app)?;
    write_json(&dir.join(HISTORY_FILE), &Vec::<HistoryEntry>::new())
}

pub fn remove_history(app: &AppHandle, id: &str) -> Result<Vec<HistoryEntry>, String> {
    let dir = data_dir(app)?;
    let mut history = load_history(app);
    history.retain(|e| e.id != id);
    write_json(&dir.join(HISTORY_FILE), &history)?;
    Ok(history)
}
