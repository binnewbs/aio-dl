fn main() {
    // Expose the compile-time target triple so the app can locate target-suffixed
    // sidecar binaries during development (`binaries/yt-dlp-<triple>`).
    println!(
        "cargo:rustc-env=AIO_DL_TARGET_TRIPLE={}",
        std::env::var("TARGET").unwrap_or_default()
    );
    tauri_build::build()
}
