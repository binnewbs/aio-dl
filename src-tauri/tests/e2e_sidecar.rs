//! End-to-end test: build argv with the real driver, run the real aria2c
//! sidecar against a local HTTP server, and confirm both the file and the
//! parsed progress.
//!
//! Skipped automatically when the sidecar binary is not present (e.g. before
//! `npm run sidecars`).

use app_lib::backends::{ParseState, driver_for};
use app_lib::types::{Backend, BackendArgs, JobRequest, Settings};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

const PAYLOAD_SIZE: usize = 512 * 1024;

/// Minimal HTTP/1.1 server that serves one file at `/sample.bin`.
fn start_server(shutdown: Arc<AtomicBool>) -> (u16, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();

    let handle = std::thread::spawn(move || {
        let payload = vec![0xABu8; PAYLOAD_SIZE];
        while !shutdown.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream
                        .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                        .ok();
                    let mut reader = BufReader::new(stream.try_clone().unwrap());

                    let mut request_line = String::new();
                    if reader.read_line(&mut request_line).is_err() {
                        continue;
                    }

                    // Drain headers.
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                            break;
                        }
                    }

                    let is_head = request_line.starts_with("HEAD");
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        PAYLOAD_SIZE
                    );
                    if !is_head {
                        let _ = stream.write_all(&payload);
                    }
                    let _ = stream.flush();
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }
    });

    (port, handle)
}

fn sidecar_path(name: &str) -> PathBuf {
    let triple = env!("AIO_DL_TARGET_TRIPLE");
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("{name}-{triple}{}", std::env::consts::EXE_SUFFIX))
}

fn test_settings(output_dir: PathBuf) -> Settings {
    Settings {
        output_dir: output_dir.display().to_string(),
        max_concurrent: 1,
        retries: 2,
        aria2_connections: 4,
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

#[test]
fn aria2_downloads_through_real_driver_argv() {
    let binary = sidecar_path("aria2c");
    if !binary.exists() {
        eprintln!(
            "skipping: {} not found (run `npm run sidecars`)",
            binary.display()
        );
        return;
    }

    let shutdown = Arc::new(AtomicBool::new(false));
    let (port, server) = start_server(shutdown.clone());

    let out_dir = std::env::temp_dir().join(format!("aio-dl-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out_dir);
    std::fs::create_dir_all(&out_dir).unwrap();

    let url = format!("http://127.0.0.1:{port}/sample.bin");
    let job = JobRequest {
        url: url.clone(),
        backend: Backend::Aria2,
        output_dir: None,
        title: None,
        format: None,
    };

    let driver = driver_for(Backend::Aria2);
    let settings = test_settings(out_dir.clone());
    let args = driver.args(&job, &settings, None);

    let output = Command::new(&binary)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("run aria2c sidecar");

    shutdown.store(true, Ordering::Relaxed);
    let _ = server.join();

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "aria2c failed.\nargs: {args:?}\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );

    // The file must exist with the exact payload size.
    let downloaded = out_dir.join("sample.bin");
    assert!(
        downloaded.exists(),
        "expected {} to exist",
        downloaded.display()
    );
    let size = std::fs::metadata(&downloaded).unwrap().len();
    assert_eq!(size as usize, PAYLOAD_SIZE);

    // And the driver must extract the final path from the real output. A fast
    // local download may not print a summary block, but it always prints the
    // `Download complete:` notice.
    let mut state = ParseState::default();
    let mut final_path: Option<String> = None;
    for line in stdout.lines().chain(stderr.lines()) {
        if let Some(path) = driver
            .parse_line(line, &mut state)
            .and_then(|delta| delta.output_path)
        {
            final_path = Some(path);
        }
    }

    let parsed = final_path.expect("aria2c completion path was not parsed");
    assert!(
        parsed.ends_with("sample.bin"),
        "unexpected parsed path: {parsed}"
    );

    let _ = std::fs::remove_dir_all(&out_dir);
}

#[test]
fn yt_dlp_template_round_trips_through_the_parser() {
    // Guards the bug where `--progress-template "download:..."` had its prefix
    // stripped by yt-dlp, so the parser never matched and the UI bar stayed 0.
    let binary = sidecar_path("yt-dlp");
    if !binary.exists() {
        eprintln!(
            "skipping: {} not found (run `npm run sidecars`)",
            binary.display()
        );
        return;
    }

    let shutdown = Arc::new(AtomicBool::new(false));
    let (port, server) = start_server(shutdown.clone());

    let out_dir = std::env::temp_dir().join(format!("aio-dl-ytdlp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out_dir);
    std::fs::create_dir_all(&out_dir).unwrap();

    let driver = driver_for(Backend::Ytdlp);
    let settings = test_settings(out_dir.clone());
    let job = JobRequest {
        url: format!("http://127.0.0.1:{port}/sample.bin"),
        backend: Backend::Ytdlp,
        output_dir: None,
        title: None,
        format: None,
    };

    // Use the driver's own argv so the template stays in sync with production.
    let args = driver.args(&job, &settings, None);
    let output = Command::new(&binary)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("run yt-dlp sidecar");

    shutdown.store(true, Ordering::Relaxed);
    let _ = server.join();

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    let mut state = ParseState::default();
    let mut percents = Vec::new();
    let mut reported_path: Option<String> = None;

    for line in stdout.lines().chain(stderr.lines()) {
        if let Some(delta) = driver.parse_line(line, &mut state) {
            if let Some(p) = delta.percent {
                percents.push(p);
            }
            if let Some(path) = delta.output_path {
                reported_path = Some(path);
            }
        }
    }

    // The whole point: at least one progress tick must parse.
    assert!(
        !percents.is_empty(),
        "no progress parsed from yt-dlp.\nargs: {args:?}\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        percents.iter().all(|p| (0.0..=100.0).contains(p)),
        "percent out of range: {percents:?}"
    );
    // Progress must reach 100% for a complete download.
    assert!(
        percents.iter().any(|p| *p >= 99.0),
        "progress never reached 100%: {percents:?}"
    );
    // yt-dlp renames unknown extensions, so assert it reported *a* path that
    // lives in our output directory rather than guessing the exact filename.
    let path = reported_path.expect("yt-dlp did not report an artifact path");
    assert!(
        path.starts_with(&out_dir.display().to_string()),
        "artifact path outside output dir: {path}"
    );
    assert!(
        std::path::Path::new(&path).exists(),
        "reported artifact does not exist: {path}"
    );

    let _ = std::fs::remove_dir_all(&out_dir);
}

#[test]
fn every_sidecar_binary_reports_a_version() {
    let names = ["yt-dlp", "gallery-dl", "aria2c", "spotdl", "ffmpeg"];
    let mut missing = Vec::new();

    for name in names {
        let path = sidecar_path(name);
        if !path.exists() {
            missing.push(name);
            continue;
        }
        let output = Command::new(&path)
            .arg("--version")
            .output()
            .unwrap_or_else(|e| panic!("failed to run {name}: {e}"));

        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            !combined.trim().is_empty(),
            "{name} --version produced no output"
        );
    }

    if !missing.is_empty() {
        eprintln!("skipping version check for missing sidecars: {missing:?}");
    }
}
