mod backends;
mod binaries;
mod commands;
mod detect;
mod jobs;
mod progress;
mod storage;
mod types;

use jobs::SharedJobs;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(jobs::new_manager())
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::get_history,
            commands::clear_history,
            commands::remove_history,
            commands::check_binaries,
            commands::enqueue_job,
            commands::list_jobs,
            commands::cancel_job,
            commands::retry_job,
            commands::clear_finished_jobs,
            commands::app_info,
            commands::reveal_path,
            detect::probe_url,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Ensure the download directory exists before the first job runs.
            let settings = storage::load_settings(app.handle());
            if !settings.output_dir.trim().is_empty() {
                let _ = std::fs::create_dir_all(&settings.output_dir);
            }

            // Nothing can still be running at startup.
            let state: tauri::State<'_, SharedJobs> = app.state();
            jobs::mark_interrupted(app.handle(), state.inner().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
