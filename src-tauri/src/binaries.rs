use crate::types::{Backend, BinaryStatus};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// Name of the bundled binary on disk (bundled builds drop the target suffix).
pub fn sidecar_file_name(logical: &str) -> String {
    let suffix = std::env::consts::EXE_SUFFIX;
    format!("{logical}{suffix}")
}

pub fn install_hint(logical: &str) -> String {
    let cmd = if cfg!(target_os = "macos") {
        "brew install"
    } else if cfg!(target_os = "windows") {
        "winget install"
    } else {
        "sudo pacman -S --needed"
    };
    match logical {
        "yt-dlp" => {
            format!("Missing yt-dlp. Re-run `npm run sidecars`, or install it: {cmd} yt-dlp")
        }
        "gallery-dl" => {
            "Missing gallery-dl. Re-run `npm run sidecars` (needs Python 3.10+ to build)."
                .to_string()
        }
        "aria2c" => {
            format!("Missing aria2c. Re-run `npm run sidecars`, or install it: {cmd} aria2")
        }
        "spotdl" => "Missing spotDL. Re-run `npm run sidecars`.".to_string(),
        "ffmpeg" => {
            "Missing ffmpeg. Re-run `npm run sidecars` (it copies the ffmpeg-static binary)."
                .to_string()
        }
        _ => "Missing binary.".to_string(),
    }
}

/// Resolves the on-disk path of a bundled sidecar, if Tauri can find it.
pub fn resolve_sidecar_path(app: &AppHandle, logical: &str) -> Option<PathBuf> {
    // In a bundled app the sidecars sit next to the main executable.
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidate = dir.join(sidecar_file_name(logical));
    if candidate.exists() {
        return Some(candidate);
    }

    // In dev the binaries live in src-tauri/binaries with a target-triple suffix.
    let triple = target_triple();
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "{logical}-{triple}{}",
            std::env::consts::EXE_SUFFIX
        ));
    if dev.exists() {
        return Some(dev);
    }

    let _ = app;
    None
}

pub fn target_triple() -> String {
    // Captured at build time by build.rs — matches scripts/fetch-sidecars.mjs.
    env!("AIO_DL_TARGET_TRIPLE").to_string()
}

async fn run_version(app: &AppHandle, logical: &str) -> Result<String, String> {
    let output = app
        .shell()
        .sidecar(logical)
        .map_err(|e| format!("sidecar not found: {e}"))?
        .arg("--version")
        .output()
        .await
        .map_err(|e| format!("failed to run: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    // Prefer stdout: some builds print unrelated shell noise on stderr.
    let line = stdout
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .or_else(|| {
            stderr.lines().map(str::trim).find(|l| {
                !l.is_empty() && !l.starts_with("sh:") && !l.contains("symbol lookup error")
            })
        })
        .unwrap_or("")
        .to_string();

    if line.is_empty() {
        return Err("no version output".into());
    }
    Ok(line)
}

/// Checks every bundled binary and reports its version.
pub async fn probe_all(app: AppHandle) -> Vec<BinaryStatus> {
    let mut out = Vec::new();

    // (UI key, display name, sidecar logical name)
    let entries: [(&str, &str, &str); 5] = [
        ("ytdlp", "yt-dlp", "yt-dlp"),
        ("galleryDl", "gallery-dl", "gallery-dl"),
        ("aria2", "aria2c", "aria2c"),
        ("spotDl", "spotDL", "spotdl"),
        ("ffmpeg", "ffmpeg", "ffmpeg"),
    ];

    for (key, name, sidecar_logical) in entries {
        let path = resolve_sidecar_path(&app, sidecar_logical).map(|p| p.display().to_string());

        match run_version(&app, sidecar_logical).await {
            Ok(version) => out.push(BinaryStatus {
                key: key.to_string(),
                name: name.to_string(),
                ok: true,
                version: Some(version),
                path,
                error: None,
                hint: None,
            }),
            Err(err) => out.push(BinaryStatus {
                key: key.to_string(),
                name: name.to_string(),
                ok: false,
                version: None,
                path,
                error: Some(err),
                hint: Some(install_hint(sidecar_logical)),
            }),
        }
    }

    out
}

/// The path handed to yt-dlp (`--ffmpeg-location`) and spotDL (`--ffmpeg`).
pub fn ffmpeg_path(app: &AppHandle) -> Option<String> {
    resolve_sidecar_path(app, "ffmpeg").map(|p| p.display().to_string())
}

pub fn backend_logical_name(backend: Backend) -> &'static str {
    match backend {
        Backend::Ytdlp => "yt-dlp",
        Backend::GalleryDl => "gallery-dl",
        Backend::Aria2 => "aria2c",
        Backend::SpotDl => "spotdl",
    }
}
