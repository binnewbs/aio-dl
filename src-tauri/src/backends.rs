use crate::progress::{file_name_from_url, parse_eta, parse_percent, parse_size, parse_speed};
use crate::types::{Backend, JobRequest, ProgressDelta, Settings};
use once_cell::sync::Lazy;
use regex::Regex;

/// A backend driver turns a job into a command line and turns the backend's
/// stdout/stderr lines into progress deltas.
pub trait BackendDriver: Send + Sync {
    /// Full argv (program name excluded) for the download.
    fn args(&self, job: &JobRequest, settings: &Settings, ffmpeg_path: Option<&str>)
    -> Vec<String>;

    /// Parses one stdout line into a progress update, if it carries any.
    fn parse_line(&self, line: &str, state: &mut ParseState) -> Option<ProgressDelta>;

    /// Whether the line indicates the backend reported a failure.
    fn is_error_line(&self, line: &str) -> bool {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("error:") || lower.contains("[error]") || lower.contains("error: ")
    }
}

/// Mutable scratch space handed to `parse_line` across lines of one job.
#[derive(Debug, Default)]
pub struct ParseState {
    /// Last known total, kept across lines when a backend prints it only once.
    pub total_bytes: Option<u64>,
    /// Total item count for backends that report per-item progress.
    pub items_total: Option<u64>,
    /// Items completed so far.
    pub items_done: u64,
}

pub fn driver_for(backend: Backend) -> Box<dyn BackendDriver> {
    match backend {
        Backend::Ytdlp => Box::new(YtDlpDriver),
        Backend::GalleryDl => Box::new(GalleryDlDriver),
        Backend::Aria2 => Box::new(Aria2Driver),
        Backend::SpotDl => Box::new(SpotDlDriver),
    }
}

/// Splits a user-supplied extra-arguments string into argv tokens.
/// Supports simple quoting so paths with spaces survive.
pub fn split_extra_args(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for ch in raw.chars() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => current.push(ch),
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            None => current.push(ch),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn push_extra(args: &mut Vec<String>, raw: &str) {
    args.extend(split_extra_args(raw));
}

// ---------------------------------------------------------------------------
// yt-dlp
// ---------------------------------------------------------------------------

pub struct YtDlpDriver;

static YTDLP_PROGRESS: Lazy<Regex> = Lazy::new(|| {
    // percent|speed|eta|downloaded|total|total_estimate  (the last two may be "NA")
    Regex::new(
        r"^download:(?P<percent>[^|]*)\|(?P<speed>[^|]*)\|(?P<eta>[^|]*)\|(?P<downloaded>[^|]*)\|(?P<total>[^|]*)\|(?P<estimate>.*)$",
    )
    .expect("valid yt-dlp progress regex")
});

static YTDLP_DEST: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^\[download\]\s+Destination:\s+(?P<path>.+)$")
        .expect("valid destination regex")
});

static YTDLP_ALREADY: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^\[download\]\s+(?P<path>.+)\s+has already been downloaded")
        .expect("valid already-downloaded regex")
});

impl BackendDriver for YtDlpDriver {
    fn args(
        &self,
        job: &JobRequest,
        settings: &Settings,
        ffmpeg_path: Option<&str>,
    ) -> Vec<String> {
        let mut args: Vec<String> = vec![
            "-P".into(),
            settings.output_dir.clone(),
            "--newline".into(),
            "--no-colors".into(),
            "--progress".into(),
            "--progress-template".into(),
            "download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s"
                .into(),
            "--print".into(),
            "after_move:filepath".into(),
            "--retries".into(),
            settings.retries.to_string(),
        ];

        if let Some(dir) = ffmpeg_path {
            args.push("--ffmpeg-location".into());
            args.push(dir.to_string());
        }

        if settings.audio_only {
            args.push("--extract-audio".into());
            if !settings.audio_format.trim().is_empty() {
                args.push("--audio-format".into());
                args.push(settings.audio_format.clone());
            }
        } else {
            if !settings.video_format.trim().is_empty() {
                args.push("-f".into());
                args.push(settings.video_format.clone());
            }
            if !settings.video_container.trim().is_empty() {
                args.push("--merge-output-format".into());
                args.push(settings.video_container.clone());
            }
        }

        if let Some(cookies) = settings
            .cookie_file
            .as_ref()
            .filter(|c| !c.trim().is_empty())
        {
            args.push("--cookies".into());
            args.push(cookies.clone());
        }

        push_extra(&mut args, &settings.extra_args.ytdlp);

        // `--` stops option parsing so a URL can never be read as a flag.
        args.push("--".into());
        args.push(job.url.clone());
        args
    }

    fn parse_line(&self, line: &str, state: &mut ParseState) -> Option<ProgressDelta> {
        let trimmed = line.trim();

        if let Some(caps) = YTDLP_PROGRESS.captures(trimmed) {
            let percent = parse_percent(caps.name("percent")?.as_str());
            let speed = parse_speed(caps.name("speed")?.as_str());
            let eta = parse_eta(caps.name("eta")?.as_str());

            let downloaded = caps
                .name("downloaded")
                .and_then(|m| m.as_str().trim().parse::<u64>().ok());

            // Prefer the exact total; fall back to the estimate (yt-dlp reports
            // `NA` for both on some sites).
            let total = caps
                .name("total")
                .and_then(|m| m.as_str().trim().parse::<u64>().ok())
                .filter(|v| *v > 0)
                .or_else(|| {
                    caps.name("estimate")
                        .and_then(|m| m.as_str().trim().parse::<u64>().ok())
                        .filter(|v| *v > 0)
                });

            if total.is_some() {
                state.total_bytes = total;
            }

            return Some(ProgressDelta {
                percent,
                downloaded_bytes: downloaded,
                total_bytes: total.or(state.total_bytes),
                speed_bytes_per_sec: speed,
                eta_seconds: eta,
                ..Default::default()
            });
        }

        if let Some(caps) = YTDLP_DEST.captures(trimmed) {
            return Some(ProgressDelta {
                output_path: Some(caps.name("path")?.as_str().trim().to_string()),
                ..Default::default()
            });
        }

        if let Some(caps) = YTDLP_ALREADY.captures(trimmed) {
            return Some(ProgressDelta {
                output_path: Some(caps.name("path")?.as_str().trim().to_string()),
                percent: Some(100.0),
                ..Default::default()
            });
        }

        // `--print after_move:filepath` emits the final path on its own line.
        if trimmed.starts_with('/') || trimmed.starts_with("file://") {
            let path = trimmed.strip_prefix("file://").unwrap_or(trimmed);
            return Some(ProgressDelta {
                output_path: Some(path.to_string()),
                ..Default::default()
            });
        }

        if let Some(rest) = trimmed.strip_prefix("[download] Destination: ") {
            return Some(ProgressDelta {
                output_path: Some(rest.trim().to_string()),
                ..Default::default()
            });
        }

        None
    }

    fn is_error_line(&self, line: &str) -> bool {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("error:")
            || lower.starts_with("[error]")
            || lower.contains("unable to download")
            || lower.contains("unsupported url")
    }
}

// ---------------------------------------------------------------------------
// gallery-dl
// ---------------------------------------------------------------------------

pub struct GalleryDlDriver;

/// gallery-dl prints a per-file line prefixed with `✔ ` once the file is
/// written, and `# ` when it skips an existing file.
static GDL_FILE_LINE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?P<mark>[✔*#])\s+(?P<path>.+)$").expect("valid gallery-dl file regex")
});

static GDL_PROGRESS: Lazy<Regex> = Lazy::new(|| {
    // gallery-dl prints lines like `[pixiv][info] 12/50` or ` 12 of 50`.
    Regex::new(r"(?i)\b(?P<done>\d+)\s*(?:/|of)\s*(?P<total>\d+)\b").expect("valid gdl count regex")
});

impl BackendDriver for GalleryDlDriver {
    fn args(&self, job: &JobRequest, settings: &Settings, _ffmpeg: Option<&str>) -> Vec<String> {
        let mut args: Vec<String> = vec![
            "-d".into(),
            settings.output_dir.clone(),
            "--no-colors".into(),
            "--no-mtime".into(),
        ];

        if let Some(cookies) = settings
            .cookie_file
            .as_ref()
            .filter(|c| !c.trim().is_empty())
        {
            args.push("--cookies".into());
            args.push(cookies.clone());
        }

        if settings.retries > 0 {
            args.push("--retries".into());
            args.push(settings.retries.to_string());
        }

        push_extra(&mut args, &settings.extra_args.gallery_dl);

        args.push("--".into());
        args.push(job.url.clone());
        args
    }

    fn parse_line(&self, line: &str, state: &mut ParseState) -> Option<ProgressDelta> {
        let trimmed = line.trim();

        // Only count files that were actually written (`✔`/`*`), not skipped (`#`).
        if let Some(caps) = GDL_FILE_LINE.captures(trimmed) {
            let mark = caps.name("mark")?.as_str();
            let path = caps.name("path")?.as_str().trim().to_string();

            if mark == "#" {
                return Some(ProgressDelta {
                    items_done: Some(state.items_done),
                    items_total: state.items_total,
                    message: Some("Skipped an existing file".into()),
                    ..Default::default()
                });
            }

            state.items_done += 1;
            return Some(ProgressDelta {
                items_done: Some(state.items_done),
                items_total: state.items_total,
                output_path: Some(path),
                message: Some(format!("Downloaded {} file(s)", state.items_done)),
                ..Default::default()
            });
        }

        if let Some(caps) = GDL_PROGRESS.captures(trimmed) {
            let done: u64 = caps.name("done")?.as_str().parse().ok()?;
            let total: u64 = caps.name("total")?.as_str().parse().ok()?;
            if total == 0 || done > total {
                return None;
            }
            state.items_total = Some(total);
            state.items_done = done;
            return Some(ProgressDelta {
                items_done: Some(done),
                items_total: Some(total),
                percent: Some((done as f64 / total as f64) * 100.0),
                ..Default::default()
            });
        }

        None
    }

    fn is_error_line(&self, line: &str) -> bool {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("[error]") || lower.contains("[error] ")
    }
}

// ---------------------------------------------------------------------------
// aria2c
// ---------------------------------------------------------------------------

pub struct Aria2Driver;

static ARIA2_SUMMARY: Lazy<Regex> = Lazy::new(|| {
    // `[#2089b0 12MiB/34MiB(35%) CN:5 DL:1.2MiB ETA:18s]`
    Regex::new(
        r"\[#(?P<gid>[0-9a-f]+)\s+(?P<downloaded>[^/]+)/(?P<total>[^\s(]+)(?:\((?P<percent>[^)]+)\))?(?P<rest>.*)\]",
    )
    .expect("valid aria2 summary regex")
});

static ARIA2_DL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"DL:(?P<speed>[0-9.]+[A-Za-z]*)").expect("valid aria2 DL regex"));

static ARIA2_ETA: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"ETA:(?P<eta>[0-9:]+)").expect("valid aria2 ETA regex"));

static ARIA2_SAVED: Lazy<Regex> = Lazy::new(|| {
    // aria2 prepends a timestamp: `11/25 10:12:07 [NOTICE] Download complete: ./file`
    Regex::new(r"(?i)Download complete:\s*(?P<path>.+)$").expect("valid aria2 complete regex")
});

impl BackendDriver for Aria2Driver {
    fn args(&self, job: &JobRequest, settings: &Settings, _ffmpeg: Option<&str>) -> Vec<String> {
        let connections = settings.aria2_connections.max(1).to_string();
        let mut args: Vec<String> = vec![
            "-d".into(),
            settings.output_dir.clone(),
            "--summary-interval=1".into(),
            "--console-log-level=notice".into(),
            "--enable-color=false".into(),
            "--file-allocation=none".into(),
            "--auto-file-renaming=true".into(),
            "--allow-overwrite=false".into(),
            "-x".into(),
            connections.clone(),
            "-s".into(),
            connections,
        ];

        if settings.retries > 0 {
            args.push("--max-tries".into());
            args.push(settings.retries.to_string());
            args.push("--retry-wait".into());
            args.push("2".into());
        }

        if settings.insecure_tls {
            args.push("--check-certificate=false".into());
        }

        if let Some(cookies) = settings
            .cookie_file
            .as_ref()
            .filter(|c| !c.trim().is_empty())
        {
            args.push("--load-cookies".into());
            args.push(cookies.clone());
        }

        push_extra(&mut args, &settings.extra_args.aria2);

        args.push("--".into());
        args.push(job.url.clone());
        args
    }

    fn parse_line(&self, line: &str, state: &mut ParseState) -> Option<ProgressDelta> {
        let trimmed = line.trim();

        if let Some(caps) = ARIA2_SUMMARY.captures(trimmed) {
            let total = parse_size(caps.name("total")?.as_str());
            if total.is_some() {
                state.total_bytes = total;
            }

            let downloaded = parse_size(caps.name("downloaded")?.as_str()).unwrap_or(0);

            let percent = caps
                .name("percent")
                .and_then(|m| parse_percent(m.as_str()))
                .or_else(|| {
                    // aria2 shows `12MiB/34MiB` with no percent early on.
                    match (total, downloaded) {
                        (Some(t), d) if t > 0 => Some((d as f64 / t as f64) * 100.0),
                        _ => None,
                    }
                });

            let rest = caps.name("rest").map(|m| m.as_str()).unwrap_or("");
            let speed = ARIA2_DL
                .captures(rest)
                .and_then(|c| parse_speed(c.name("speed")?.as_str()));
            let eta = ARIA2_ETA
                .captures(rest)
                .and_then(|c| parse_eta(c.name("eta")?.as_str()));

            return Some(ProgressDelta {
                percent,
                downloaded_bytes: Some(downloaded),
                total_bytes: total,
                speed_bytes_per_sec: speed,
                eta_seconds: eta,
                ..Default::default()
            });
        }

        if let Some(caps) = ARIA2_SAVED.captures(trimmed) {
            return Some(ProgressDelta {
                output_path: Some(caps.name("path")?.as_str().trim().to_string()),
                percent: Some(100.0),
                ..Default::default()
            });
        }

        None
    }

    fn is_error_line(&self, line: &str) -> bool {
        let lower = line.to_ascii_lowercase();
        lower.contains("exception caught")
            || lower.contains("error occurred")
            || lower.contains("download aborted")
    }
}

// ---------------------------------------------------------------------------
// spotDL
// ---------------------------------------------------------------------------

pub struct SpotDlDriver;

static SPOT_FOUND: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^Found\s+(?P<total>\d+)\s+songs?").expect("valid spotdl found regex")
});

static SPOT_DONE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)(downloaded|skipping|skipped)\b"#).expect("valid spotdl done regex")
});

impl BackendDriver for SpotDlDriver {
    fn args(
        &self,
        job: &JobRequest,
        settings: &Settings,
        ffmpeg_path: Option<&str>,
    ) -> Vec<String> {
        let output_template = format!(
            "{}/{{artists}} - {{title}}.{{output-ext}}",
            settings.output_dir.trim_end_matches('/')
        );

        // spotDL (argparse) has no `--` end-of-options separator, so a query that
        // starts with `-` would be parsed as a flag. Prefix such queries with a
        // space, which argparse treats as a positional value.
        let query = if job.url.starts_with('-') {
            format!(" {}", job.url)
        } else {
            job.url.clone()
        };

        let mut args: Vec<String> = vec!["download".into(), query];
        args.push("--output".into());
        args.push(output_template);
        args.push("--simple-tui".into());
        args.push("--log-level".into());
        args.push("INFO".into());

        if !settings.spotify_format.trim().is_empty() {
            args.push("--format".into());
            args.push(settings.spotify_format.clone());
        }
        if !settings.spotify_bitrate.trim().is_empty() {
            args.push("--bitrate".into());
            args.push(settings.spotify_bitrate.clone());
        }
        if let Some(ffmpeg) = ffmpeg_path {
            args.push("--ffmpeg".into());
            args.push(ffmpeg.to_string());
        }
        if let Some(cookies) = settings
            .cookie_file
            .as_ref()
            .filter(|c| !c.trim().is_empty())
        {
            args.push("--cookie-file".into());
            args.push(cookies.clone());
        }
        if settings.retries > 0 {
            args.push("--max-retries".into());
            args.push(settings.retries.to_string());
        }

        push_extra(&mut args, &settings.extra_args.spot_dl);
        args
    }

    fn parse_line(&self, line: &str, state: &mut ParseState) -> Option<ProgressDelta> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return None;
        }

        if let Some(total) = SPOT_FOUND
            .captures(trimmed)
            .and_then(|caps| caps.name("total"))
            .and_then(|m| m.as_str().parse::<u64>().ok())
        {
            state.items_total = Some(total);
            return Some(ProgressDelta {
                items_done: Some(state.items_done),
                items_total: Some(total),
                percent: Some(0.0),
                message: Some(format!("Found {total} song(s)")),
                ..Default::default()
            });
        }

        if SPOT_DONE.is_match(trimmed) {
            state.items_done += 1;
            let percent = state
                .items_total
                .filter(|t| *t > 0)
                .map(|t| ((state.items_done as f64 / t as f64) * 100.0).min(100.0));

            return Some(ProgressDelta {
                items_done: Some(state.items_done),
                items_total: state.items_total,
                percent,
                message: Some(trimmed.to_string()),
                ..Default::default()
            });
        }

        None
    }

    fn is_error_line(&self, line: &str) -> bool {
        let lower = line.to_ascii_lowercase();
        lower.contains("lookupError".to_ascii_lowercase().as_str())
            || lower.starts_with("error")
            || lower.contains("could not")
    }
}

/// Best-effort artifact filename for backends that don't print a final path.
#[allow(dead_code)]
pub fn guess_output_name(url: &str) -> Option<String> {
    file_name_from_url(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BackendArgs, JobRequest, Settings};

    fn settings() -> Settings {
        Settings {
            output_dir: "/tmp/out".into(),
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

    fn job(url: &str, backend: Backend) -> JobRequest {
        JobRequest {
            url: url.into(),
            backend,
            output_dir: None,
            title: None,
        }
    }

    #[test]
    fn extra_args_quoting() {
        assert_eq!(
            split_extra_args("--a 1 --b \"two words\""),
            vec!["--a", "1", "--b", "two words"]
        );
        assert_eq!(split_extra_args("   "), Vec::<String>::new());
        assert_eq!(split_extra_args("--x 'a b'"), vec!["--x", "a b"]);
    }

    #[test]
    fn ytdlp_args_end_with_separator_and_url() {
        let d = YtDlpDriver;
        let args = d.args(
            &job("https://youtu.be/x", Backend::Ytdlp),
            &settings(),
            Some("/opt"),
        );
        assert_eq!(args[args.len() - 2], "--");
        assert_eq!(args[args.len() - 1], "https://youtu.be/x");
        assert!(args.contains(&"--ffmpeg-location".to_string()));
        assert!(args.windows(2).any(|w| w[0] == "-P" && w[1] == "/tmp/out"));
    }

    #[test]
    fn ytdlp_url_cannot_inject_flags() {
        let d = YtDlpDriver;
        let args = d.args(&job("--exec=rm -rf /", Backend::Ytdlp), &settings(), None);
        let idx = args
            .iter()
            .position(|a| a == "--")
            .expect("separator present");
        assert_eq!(idx, args.len() - 2);
    }

    #[test]
    fn ytdlp_progress_line() {
        let d = YtDlpDriver;
        let mut state = ParseState::default();
        let delta = d
            .parse_line(
                "download:  45.2%| 1.5MiB/s|00:12|1048576|2320000|2320000",
                &mut state,
            )
            .expect("parsed");
        assert_eq!(delta.percent, Some(45.2));
        assert_eq!(delta.total_bytes, Some(2_320_000));
        assert_eq!(delta.downloaded_bytes, Some(1_048_576));
        assert!(delta.speed_bytes_per_sec.unwrap() > 1_500_000.0);
        assert_eq!(delta.eta_seconds, Some(12));
    }

    #[test]
    fn ytdlp_progress_keeps_total_when_missing() {
        let d = YtDlpDriver;
        let mut state = ParseState::default();
        let _ = d.parse_line("download:  10%| 1MiB/s|00:30|100|1000|1000", &mut state);
        let delta = d
            .parse_line("download:  20%| 1MiB/s|00:25|200|NA|NA", &mut state)
            .expect("parsed");
        assert_eq!(delta.total_bytes, Some(1000));
    }

    #[test]
    fn ytdlp_falls_back_to_estimate_when_total_missing() {
        let d = YtDlpDriver;
        let mut state = ParseState::default();
        let delta = d
            .parse_line("download:  30%| 1MiB/s|00:20|300|NA|1000", &mut state)
            .expect("parsed");
        assert_eq!(delta.total_bytes, Some(1000));
        assert_eq!(delta.percent, Some(30.0));
    }

    #[test]
    fn ytdlp_handles_both_sizes_missing() {
        let d = YtDlpDriver;
        let mut state = ParseState::default();
        let delta = d
            .parse_line("download:  30%| 1MiB/s|00:20|300|NA|NA", &mut state)
            .expect("parsed");
        assert_eq!(delta.total_bytes, None);
        assert_eq!(delta.downloaded_bytes, Some(300));
    }

    #[test]
    fn gallery_dl_counts_downloaded_files() {
        let d = GalleryDlDriver;
        let mut state = ParseState::default();
        let a = d.parse_line("✔ /tmp/out/a.jpg", &mut state).expect("file");
        assert_eq!(a.items_done, Some(1));
        let b = d.parse_line("✔ /tmp/out/b.jpg", &mut state).expect("file");
        assert_eq!(b.items_done, Some(2));
    }

    #[test]
    fn gallery_dl_does_not_count_skipped_files() {
        let d = GalleryDlDriver;
        let mut state = ParseState::default();
        let _ = d.parse_line("✔ /tmp/out/a.jpg", &mut state);
        let skipped = d.parse_line("# /tmp/out/a.jpg", &mut state).expect("skip");
        assert_eq!(skipped.items_done, Some(1));
        assert!(skipped.message.unwrap_or_default().contains("Skipped"));
    }

    #[test]
    fn gallery_dl_reads_counts() {
        let d = GalleryDlDriver;
        let mut state = ParseState::default();
        let delta = d
            .parse_line("[pixiv][info] 5/20", &mut state)
            .expect("counts");
        assert_eq!(delta.items_done, Some(5));
        assert_eq!(delta.items_total, Some(20));
        assert_eq!(delta.percent, Some(25.0));
    }

    #[test]
    fn aria2_summary_line() {
        let d = Aria2Driver;
        let mut state = ParseState::default();
        let delta = d
            .parse_line(
                "[#2089b0 12MiB/34MiB(35%) CN:5 DL:1.2MiB ETA:18s]",
                &mut state,
            )
            .expect("parsed");
        assert_eq!(delta.percent, Some(35.0));
        assert_eq!(delta.total_bytes, Some(34 * 1024 * 1024));
        assert_eq!(delta.downloaded_bytes, Some(12 * 1024 * 1024));
        assert!(delta.speed_bytes_per_sec.is_some());
        assert_eq!(delta.eta_seconds, Some(18));
    }

    #[test]
    fn aria2_derives_percent_without_explicit_value() {
        let d = Aria2Driver;
        let mut state = ParseState::default();
        let delta = d
            .parse_line("[#abc 1MiB/4MiB DL:100KiB ETA:30s]", &mut state)
            .expect("parsed");
        assert_eq!(delta.percent, Some(25.0));
    }

    #[test]
    fn aria2_complete_line_is_timestamped() {
        let d = Aria2Driver;
        let mut state = ParseState::default();
        // Real aria2 output includes a timestamp and a level tag.
        let delta = d
            .parse_line(
                "11/25 10:12:07 [NOTICE] Download complete: /tmp/out/sample.bin",
                &mut state,
            )
            .expect("parsed");
        assert_eq!(delta.output_path.as_deref(), Some("/tmp/out/sample.bin"));
        assert_eq!(delta.percent, Some(100.0));
    }

    #[test]
    fn spotdl_counts_songs() {
        let d = SpotDlDriver;
        let mut state = ParseState::default();
        let found = d
            .parse_line("Found 4 songs in playlist", &mut state)
            .expect("found");
        assert_eq!(found.items_total, Some(4));
        let done = d
            .parse_line("Downloaded \"Song\" \u{2192} /tmp/out/song.mp3", &mut state)
            .expect("done");
        assert_eq!(done.items_done, Some(1));
        assert_eq!(done.percent, Some(25.0));
    }

    #[test]
    fn spotdl_args_use_output_template() {
        let d = SpotDlDriver;
        let args = d.args(
            &job("https://open.spotify.com/track/x", Backend::SpotDl),
            &settings(),
            Some("/opt/ffmpeg"),
        );
        assert_eq!(args[0], "download");
        let out_idx = args.iter().position(|a| a == "--output").unwrap();
        assert_eq!(
            args[out_idx + 1],
            "/tmp/out/{artists} - {title}.{output-ext}"
        );
        assert!(args.iter().any(|a| a == "/opt/ffmpeg"));
    }

    #[test]
    fn spotdl_dash_query_cannot_be_read_as_a_flag() {
        let d = SpotDlDriver;
        let args = d.args(&job("--version", Backend::SpotDl), &settings(), None);
        assert_eq!(args[0], "download");
        // The query must be neutralised so argparse treats it as search text.
        assert_eq!(args[1], " --version");
        assert!(!args.iter().any(|a| a == "--version"));
    }
}
