use crate::backends::{ParseState, driver_for};
use crate::binaries::{backend_logical_name, ffmpeg_path};
use crate::progress::file_name_from_url;
use crate::storage;
use crate::types::{
    HistoryEntry, JobRequest, JobSnapshot, JobStatus, ProgressDelta, Settings, now_millis,
};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

const LOG_TAIL_LIMIT: usize = 200;

pub struct RunningJob {
    pub child: CommandChild,
}

#[derive(Default)]
pub struct JobManager {
    pub jobs: HashMap<String, JobSnapshot>,
    pub queue: VecDeque<String>,
    pub running: HashMap<String, RunningJob>,
}

pub type SharedJobs = Arc<Mutex<JobManager>>;

pub fn new_manager() -> SharedJobs {
    Arc::new(Mutex::new(JobManager::default()))
}

fn emit_job(app: &AppHandle, job: &JobSnapshot) {
    let _ = app.emit("job:update", job);
}

fn emit_log(app: &AppHandle, id: &str, line: String) {
    let _ = app.emit("job:log", serde_json::json!({ "id": id, "line": line }));
}

/// Builds a fresh queued snapshot for a download request.
fn snapshot_from_request(req: &JobRequest) -> JobSnapshot {
    let fallback_title = req
        .title
        .clone()
        .or_else(|| file_name_from_url(&req.url))
        .unwrap_or_else(|| req.url.clone());

    JobSnapshot {
        id: uuid::Uuid::new_v4().to_string(),
        url: req.url.clone(),
        title: fallback_title,
        backend: req.backend,
        status: JobStatus::Queued,
        percent: None,
        downloaded_bytes: 0,
        total_bytes: None,
        speed_bytes_per_sec: None,
        eta_seconds: None,
        items_done: 0,
        items_total: None,
        output_path: None,
        message: Some(format!("Waiting to start · {}", req.backend.display_name())),
        error: None,
        created_at: now_millis(),
        finished_at: None,
        log_tail: Vec::new(),
        format: req.format.clone(),
    }
}

/// Applies a progress delta to a snapshot, keeping monotonic counters sane.
fn apply_delta(job: &mut JobSnapshot, delta: ProgressDelta) {
    if let Some(percent) = delta.percent {
        job.percent = Some(percent.clamp(0.0, 100.0));
    }
    if let Some(downloaded) = delta.downloaded_bytes {
        job.downloaded_bytes = downloaded;
    }
    if let Some(total) = delta.total_bytes {
        job.total_bytes = Some(total);
    }
    if let Some(speed) = delta.speed_bytes_per_sec {
        job.speed_bytes_per_sec = Some(speed);
    }
    if let Some(eta) = delta.eta_seconds {
        job.eta_seconds = Some(eta);
    }
    if let Some(done) = delta.items_done {
        job.items_done = job.items_done.max(done);
    }
    if let Some(total) = delta.items_total {
        job.items_total = Some(total);
    }
    if let Some(message) = delta.message {
        job.message = Some(message);
    }
    if let Some(path) = delta.output_path {
        job.output_path = Some(path);
    }
}

fn push_log(job: &mut JobSnapshot, line: String) {
    job.log_tail.push(line);
    if job.log_tail.len() > LOG_TAIL_LIMIT {
        let excess = job.log_tail.len() - LOG_TAIL_LIMIT;
        job.log_tail.drain(0..excess);
    }
}

fn history_from(job: &JobSnapshot) -> HistoryEntry {
    HistoryEntry {
        id: job.id.clone(),
        url: job.url.clone(),
        title: job.title.clone(),
        backend: job.backend,
        status: job.status,
        output_path: job.output_path.clone(),
        total_bytes: job
            .total_bytes
            .or(Some(job.downloaded_bytes))
            .filter(|v| *v > 0),
        error: job.error.clone(),
        created_at: job.created_at,
        finished_at: job.finished_at,
    }
}

/// Creates a job, queues it, and immediately tries to start it.
pub fn enqueue(app: AppHandle, shared: SharedJobs, req: JobRequest) -> Result<JobSnapshot, String> {
    let snapshot = snapshot_from_request(&req);

    {
        let mut manager = shared.lock().map_err(|_| "job manager poisoned")?;
        manager.jobs.insert(snapshot.id.clone(), snapshot.clone());
        manager.queue.push_back(snapshot.id.clone());
    }

    emit_job(&app, &snapshot);
    pump(app, shared)?;
    Ok(snapshot)
}

/// Starts as many queued jobs as the concurrency limit allows.
pub fn pump(app: AppHandle, shared: SharedJobs) -> Result<(), String> {
    let settings = storage::load_settings(&app);
    let to_start: Vec<JobSnapshot> = {
        let mut manager = shared.lock().map_err(|_| "job manager poisoned")?;
        let limit = settings.max_concurrent.max(1) as usize;
        let mut started = Vec::new();

        // Count already-running jobs plus the ones reserved in this batch, so a
        // single pump call can never exceed the limit.
        while manager.running.len() + started.len() < limit {
            let Some(next_id) = manager.queue.pop_front() else {
                break;
            };
            let Some(job) = manager.jobs.get_mut(&next_id) else {
                continue;
            };
            if job.status != JobStatus::Queued {
                continue;
            }
            // Reserve the slot before spawning; spawn_job re-emits Running.
            job.status = JobStatus::Running;
            job.message = Some(format!("Starting {}", job.backend.display_name()));
            started.push(job.clone());
        }
        started
    };

    for job in to_start {
        spawn_job(app.clone(), shared.clone(), job, settings.clone());
    }
    Ok(())
}

fn spawn_job(app: AppHandle, shared: SharedJobs, job: JobSnapshot, settings: Settings) {
    let id = job.id.clone();
    let backend = job.backend;
    let logical = backend_logical_name(backend);

    // The user may have cancelled between pump() and this call. Also re-emit the
    // reserved Running state so the UI reflects the transition immediately.
    {
        let Ok(mut manager) = shared.lock() else {
            return;
        };
        let Some(entry) = manager.jobs.get_mut(&id) else {
            return;
        };
        if entry.status != JobStatus::Running {
            // Cancelled (or otherwise finished) before the process started.
            return;
        }
        entry.message = Some(format!("Starting {}", backend.display_name()));
        emit_job(&app, entry);
    }

    let app_for_task = app.clone();
    let shared_for_task = shared.clone();
    let job_for_task = job.clone();

    tauri::async_runtime::spawn(async move {
        let ffmpeg = ffmpeg_path(&app_for_task);
        let request = JobRequest {
            url: job_for_task.url.clone(),
            backend: job_for_task.backend,
            output_dir: None,
            title: Some(job_for_task.title.clone()),
            format: job_for_task.format.clone(),
        };

        let driver = driver_for(backend);
        let args = driver.args(&request, &settings, ffmpeg.as_deref());

        let command = match app_for_task.shell().sidecar(logical) {
            Ok(cmd) => cmd.args(args),
            Err(err) => {
                finish_job(
                    &app_for_task,
                    &shared_for_task,
                    &id,
                    JobStatus::Failed,
                    Some(format!(
                        "{} is not available: {err}. Open the Doctor panel to see which binaries are missing.",
                        backend.display_name()
                    )),
                );
                return;
            }
        };

        let (mut rx, child) = match command.spawn() {
            Ok(pair) => pair,
            Err(err) => {
                finish_job(
                    &app_for_task,
                    &shared_for_task,
                    &id,
                    JobStatus::Failed,
                    Some(format!("Failed to start {}: {err}", backend.display_name())),
                );
                return;
            }
        };

        {
            let Ok(mut manager) = shared_for_task.lock() else {
                return;
            };
            manager.running.insert(id.clone(), RunningJob { child });
        }

        let mut state = ParseState::for_job(settings.output_dir.clone(), &settings.spotify_format);
        let mut last_error: Option<String> = None;
        let mut cancelled = false;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    for chunk in line.lines() {
                        handle_line(
                            &app_for_task,
                            &shared_for_task,
                            &id,
                            driver.as_ref(),
                            chunk,
                            &mut state,
                            &mut last_error,
                        );
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    for chunk in line.lines() {
                        if driver.is_error_line(chunk) {
                            let trimmed = chunk.trim();
                            if !trimmed.is_empty() {
                                last_error = Some(trimmed.to_string());
                            }
                        }
                        handle_line(
                            &app_for_task,
                            &shared_for_task,
                            &id,
                            driver.as_ref(),
                            chunk,
                            &mut state,
                            &mut last_error,
                        );
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let code = payload.code.unwrap_or(-1);
                    let was_cancelled = {
                        let Ok(manager) = shared_for_task.lock() else {
                            return;
                        };
                        manager
                            .jobs
                            .get(&id)
                            .map(|j| j.status == JobStatus::Cancelled)
                            .unwrap_or(false)
                    };
                    cancelled = was_cancelled;

                    {
                        let Ok(mut manager) = shared_for_task.lock() else {
                            return;
                        };
                        manager.running.remove(&id);
                    }

                    let status = if cancelled {
                        JobStatus::Cancelled
                    } else if code == 0 {
                        JobStatus::Completed
                    } else {
                        JobStatus::Failed
                    };

                    let message = if status == JobStatus::Failed {
                        Some(match last_error {
                            Some(err) => err,
                            None => format!(
                                "{} exited with code {code}. Check the log for details.",
                                backend.display_name()
                            ),
                        })
                    } else {
                        None
                    };

                    finish_job(&app_for_task, &shared_for_task, &id, status, message);
                    let _ = pump(app_for_task.clone(), shared_for_task.clone());
                    return;
                }
                CommandEvent::Error(err) => {
                    last_error = Some(err);
                }
                _ => {}
            }
        }

        // The stream closed without a Terminated event (process vanished).
        {
            let Ok(mut manager) = shared_for_task.lock() else {
                return;
            };
            manager.running.remove(&id);
        }
        if !cancelled {
            finish_job(
                &app_for_task,
                &shared_for_task,
                &id,
                JobStatus::Failed,
                last_error.or_else(|| Some("The download process ended unexpectedly.".into())),
            );
        }
        let _ = pump(app_for_task, shared_for_task);
    });
}

fn handle_line(
    app: &AppHandle,
    shared: &SharedJobs,
    id: &str,
    driver: &dyn crate::backends::BackendDriver,
    line: &str,
    state: &mut ParseState,
    last_error: &mut Option<String>,
) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }

    if driver.is_error_line(trimmed) {
        *last_error = Some(trimmed.to_string());
    }

    let delta = driver.parse_line(trimmed, state);

    let Ok(mut manager) = shared.lock() else {
        return;
    };
    let Some(job) = manager.jobs.get_mut(id) else {
        return;
    };

    let mut changed = false;
    if let Some(delta) = delta {
        apply_delta(job, delta);
        changed = true;
    }

    // Keep a bounded log tail for the UI, without spamming every progress tick.
    let is_progress = trimmed.starts_with("AIO_PROGRESS|") || trimmed.starts_with("[#");
    if !is_progress {
        push_log(job, trimmed.to_string());
        emit_log(app, id, trimmed.to_string());
        changed = true;
    }

    if changed {
        emit_job(app, job);
    }
}

fn finish_job(
    app: &AppHandle,
    shared: &SharedJobs,
    id: &str,
    status: JobStatus,
    error: Option<String>,
) {
    let finished = {
        let Ok(mut manager) = shared.lock() else {
            return;
        };
        let Some(job) = manager.jobs.get_mut(id) else {
            return;
        };

        // Never overwrite an explicit cancellation.
        if job.status == JobStatus::Cancelled && status != JobStatus::Cancelled {
            job.finished_at = Some(now_millis());
            emit_job(app, job);
            return;
        }

        job.status = status;
        job.finished_at = Some(now_millis());
        job.speed_bytes_per_sec = None;
        job.eta_seconds = None;

        if status == JobStatus::Completed {
            job.percent = Some(100.0);

            // Backends differ in what they report: yt-dlp prints the final
            // path, aria2c prints an absolute path, gallery-dl prints each
            // file, and spotDL prints none. When nothing was reported (or the
            // reported path no longer exists), fall back to the output
            // directory so "open containing folder" always works.
            let reported_exists = job
                .output_path
                .as_deref()
                .map(std::path::Path::new)
                .map(|p| p.exists())
                .unwrap_or(false);

            if !reported_exists {
                let settings = storage::load_settings(app);
                job.output_path = Some(settings.output_dir.clone());
            }

            // Trust the filesystem over the backend's often-missing size field
            // (yt-dlp reports `NA` for total_bytes_estimate on many sites).
            if let Some(meta) = job
                .output_path
                .as_deref()
                .and_then(|path| std::fs::metadata(path).ok())
                .filter(|meta| meta.is_file())
            {
                let size = meta.len();
                job.downloaded_bytes = size;
                job.total_bytes = Some(size);
            }

            if job.total_bytes.is_none() && job.downloaded_bytes > 0 {
                job.total_bytes = Some(job.downloaded_bytes);
            }

            // Replace a URL-only title with the actual downloaded file name.
            // Only for a real file, not the directory fallback above.
            if (job.title == job.url || job.title.trim().is_empty())
                && let Some(name) = job
                    .output_path
                    .as_deref()
                    .map(std::path::Path::new)
                    .filter(|p| p.is_file())
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
            {
                job.title = name.to_string();
            }

            job.message = Some("Completed".into());
        } else if status == JobStatus::Failed {
            job.error = error.clone();
            job.message = Some("Failed".into());
        } else if status == JobStatus::Cancelled {
            job.message = Some("Cancelled".into());
        }

        emit_job(app, job);
        job.clone()
    };

    let _ = storage::append_history(app, history_from(&finished));
    let _ = app.emit("history:changed", ());

    // Optionally reveal the finished file in the OS file manager.
    if finished.status == JobStatus::Completed {
        let settings = storage::load_settings(app);
        if settings.open_folder_on_complete {
            let target = finished
                .output_path
                .clone()
                .unwrap_or_else(|| settings.output_dir.clone());
            reveal_in_file_manager(app, &target);
        }
    }
}

/// Opens the containing folder of `path` (or `path` itself if it is a directory).
fn reveal_in_file_manager(app: &AppHandle, path: &str) {
    use tauri_plugin_opener::OpenerExt;

    let target = std::path::Path::new(path);
    let to_open = if target.is_dir() {
        target.to_path_buf()
    } else {
        target
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| target.to_path_buf())
    };

    if !to_open.exists() {
        return;
    }

    let _ = app
        .opener()
        .open_path(to_open.display().to_string(), None::<&str>);
}

/// Cancels a queued or running job.
pub fn cancel(app: &AppHandle, shared: SharedJobs, id: &str) -> Result<(), String> {
    let child = {
        let mut manager = shared.lock().map_err(|_| "job manager poisoned")?;

        if let Some(pos) = manager.queue.iter().position(|q| q == id) {
            manager.queue.remove(pos);
            if let Some(job) = manager.jobs.get_mut(id) {
                job.status = JobStatus::Cancelled;
                job.finished_at = Some(now_millis());
                job.message = Some("Cancelled".into());
                emit_job(app, job);
            }
            return Ok(());
        }

        if let Some(job) = manager.jobs.get_mut(id) {
            job.status = JobStatus::Cancelled;
            job.message = Some("Cancelling…".into());
            emit_job(app, job);
        }

        manager.running.remove(id).map(|r| r.child)
    };

    match child {
        Some(child) => child.kill().map_err(|e| format!("kill failed: {e}")),
        None => Ok(()),
    }
}

/// Re-queues a finished job using its original request.
pub fn retry(app: AppHandle, shared: SharedJobs, id: &str) -> Result<JobSnapshot, String> {
    let request = {
        let manager = shared.lock().map_err(|_| "job manager poisoned")?;
        let job = manager
            .jobs
            .get(id)
            .ok_or_else(|| "job not found".to_string())?;
        JobRequest {
            url: job.url.clone(),
            backend: job.backend,
            output_dir: None,
            title: Some(job.title.clone()),
            format: job.format.clone(),
        }
    };
    enqueue(app, shared, request)
}

/// Marks previously-running jobs as interrupted (called once at startup).
pub fn mark_interrupted(app: &AppHandle, shared: SharedJobs) {
    let Ok(mut manager) = shared.lock() else {
        return;
    };
    for job in manager.jobs.values_mut() {
        if matches!(job.status, JobStatus::Running | JobStatus::Queued) {
            job.status = JobStatus::Interrupted;
            job.finished_at = Some(now_millis());
            job.message = Some("Interrupted by app restart".into());
            job.speed_bytes_per_sec = None;
            job.eta_seconds = None;
            emit_job(app, job);
        }
    }
}

pub fn snapshots(shared: &SharedJobs) -> Vec<JobSnapshot> {
    let Ok(manager) = shared.lock() else {
        return Vec::new();
    };
    let mut jobs: Vec<JobSnapshot> = manager.jobs.values().cloned().collect();
    jobs.sort_by_key(|j| j.created_at);
    jobs
}

pub fn clear_finished(shared: &SharedJobs) {
    let Ok(mut manager) = shared.lock() else {
        return;
    };
    let keep: Vec<String> = manager
        .jobs
        .iter()
        .filter(|(_, j)| matches!(j.status, JobStatus::Queued | JobStatus::Running))
        .map(|(id, _)| id.clone())
        .collect();
    manager.jobs.retain(|id, _| keep.contains(id));
}
