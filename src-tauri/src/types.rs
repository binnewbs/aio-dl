use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Backend {
    Ytdlp,
    GalleryDl,
    Aria2,
    SpotDl,
}

impl Backend {
    pub fn display_name(self) -> &'static str {
        match self {
            Backend::Ytdlp => "yt-dlp",
            Backend::GalleryDl => "gallery-dl",
            Backend::Aria2 => "aria2c",
            Backend::SpotDl => "spotDL",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

/// Per-download format override for yt-dlp. Any `None` field falls back to the
/// value stored in [`Settings`], so an empty override behaves like "use my
/// defaults".
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatOverride {
    /// yt-dlp `-f` expression, e.g. `bv*[height<=720]+ba/b[height<=720]`.
    #[serde(default)]
    pub format: Option<String>,
    /// Extract audio instead of saving video.
    #[serde(default)]
    pub audio_only: Option<bool>,
    /// Audio container when `audio_only` is set (`mp3`, `m4a`, …).
    #[serde(default)]
    pub audio_format: Option<String>,
    /// Merge container when saving video (`mp4`, `mkv`, …).
    #[serde(default)]
    pub container: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRequest {
    pub url: String,
    pub backend: Backend,
    /// Optional per-job output directory override.
    #[serde(default)]
    pub output_dir: Option<String>,
    /// Optional title hint supplied by the UI (e.g. the page title).
    #[serde(default)]
    pub title: Option<String>,
    /// Optional per-job yt-dlp format choice, set from the Downloads view.
    #[serde(default)]
    pub format: Option<FormatOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub id: String,
    pub url: String,
    pub title: String,
    pub backend: Backend,
    pub status: JobStatus,
    /// 0.0–100.0 when a real percentage is known, otherwise `None`.
    pub percent: Option<f64>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_sec: Option<f64>,
    pub eta_seconds: Option<u64>,
    /// Counts for backends that have no percentage (gallery-dl, spotDL).
    pub items_done: u64,
    pub items_total: Option<u64>,
    pub output_path: Option<String>,
    pub message: Option<String>,
    pub error: Option<String>,
    pub created_at: i64,
    pub finished_at: Option<i64>,
    pub log_tail: Vec<String>,
    /// The format chosen for this download, kept so retries reuse it.
    #[serde(default)]
    pub format: Option<FormatOverride>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressDelta {
    pub percent: Option<f64>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_sec: Option<f64>,
    pub eta_seconds: Option<u64>,
    pub items_done: Option<u64>,
    pub items_total: Option<u64>,
    pub message: Option<String>,
    pub output_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub output_dir: String,
    pub max_concurrent: u32,
    pub retries: u32,
    pub aria2_connections: u32,
    pub cookie_file: Option<String>,
    #[serde(default)]
    pub cookie_browser: Option<String>,
    /// yt-dlp format selector, e.g. "bv*+ba/b".
    pub video_format: String,
    /// When true, yt-dlp extracts audio instead of video.
    pub audio_only: bool,
    /// Audio conversion target for yt-dlp (`mp3`, `m4a`, `opus`, …). Empty disables conversion.
    pub audio_format: String,
    /// Video container preference for yt-dlp merging (`mp4`, `mkv`, ...).
    pub video_container: String,
    pub spotify_format: String,
    pub spotify_bitrate: String,
    pub extra_args: BackendArgs,
    pub open_folder_on_complete: bool,
    pub insecure_tls: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendArgs {
    #[serde(default)]
    pub ytdlp: String,
    #[serde(default)]
    pub gallery_dl: String,
    #[serde(default)]
    pub aria2: String,
    #[serde(default)]
    pub spot_dl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub url: String,
    pub title: String,
    pub backend: Backend,
    pub status: JobStatus,
    pub output_path: Option<String>,
    pub total_bytes: Option<u64>,
    pub error: Option<String>,
    pub created_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryStatus {
    /// `ytdlp` | `galleryDl` | `aria2` | `spotDl` | `ffmpeg`
    pub key: String,
    pub name: String,
    pub ok: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub status: u16,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
    pub file_name: Option<String>,
    pub is_html: bool,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub target_triple: String,
    pub data_dir: String,
}

pub fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
