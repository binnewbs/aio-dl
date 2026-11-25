use crate::binaries;
use crate::jobs::{self, SharedJobs};
use crate::storage;
use crate::types::{
    AppInfo, BinaryStatus, HistoryEntry, JobRequest, JobSnapshot, Settings,
};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    storage::load_settings(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    storage::save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn get_history(app: AppHandle) -> Vec<HistoryEntry> {
    storage::load_history(&app)
}

#[tauri::command]
pub fn clear_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    storage::clear_history(&app)?;
    Ok(Vec::new())
}

#[tauri::command]
pub fn remove_history(app: AppHandle, id: String) -> Result<Vec<HistoryEntry>, String> {
    storage::remove_history(&app, &id)
}

#[tauri::command]
pub async fn check_binaries(app: AppHandle) -> Vec<BinaryStatus> {
    binaries::probe_all(app).await
}

#[tauri::command]
pub fn enqueue_job(
    app: AppHandle,
    jobs_state: State<'_, SharedJobs>,
    request: JobRequest,
) -> Result<JobSnapshot, String> {
    jobs::enqueue(app, jobs_state.inner().clone(), request)
}

#[tauri::command]
pub fn list_jobs(jobs_state: State<'_, SharedJobs>) -> Vec<JobSnapshot> {
    jobs::snapshots(jobs_state.inner())
}

#[tauri::command]
pub fn cancel_job(
    app: AppHandle,
    jobs_state: State<'_, SharedJobs>,
    id: String,
) -> Result<(), String> {
    jobs::cancel(&app, jobs_state.inner().clone(), &id)
}

#[tauri::command]
pub fn retry_job(
    app: AppHandle,
    jobs_state: State<'_, SharedJobs>,
    id: String,
) -> Result<JobSnapshot, String> {
    jobs::retry(app, jobs_state.inner().clone(), &id)
}

#[tauri::command]
pub fn clear_finished_jobs(jobs_state: State<'_, SharedJobs>) {
    jobs::clear_finished(jobs_state.inner());
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    let data_dir = storage::data_dir(&app)
        .map(|p| p.display().to_string())
        .unwrap_or_default();

    AppInfo {
        version: app.package_info().version.to_string(),
        target_triple: binaries::target_triple(),
        data_dir,
    }
}

/// Opens a downloaded file's containing folder (or the file itself).
#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    // Opening the containing directory is friendlier than launching the file.
    let target = std::path::Path::new(&path);
    let to_open = if target.is_dir() {
        target.to_path_buf()
    } else {
        target
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| target.to_path_buf())
    };

    if !to_open.exists() {
        return Err(format!("Path does not exist: {}", to_open.display()));
    }

    app.opener()
        .open_path(to_open.display().to_string(), None::<&str>)
        .map_err(|e| format!("could not open folder: {e}"))
}
