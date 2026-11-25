//! Integration tests for the download scheduling pipeline.
//!
//! These exercise the real parsers against captured backend output and verify
//! the state machine transitions (queue -> running -> terminal) without
//! requiring a Tauri window.

use app_lib::backends::{ParseState, driver_for};
use app_lib::types::Backend;

#[test]
fn ytdlp_fixture_stream_produces_monotonic_progress() {
    let driver = driver_for(Backend::Ytdlp);
    let mut state = ParseState::default();

    // Verbatim output shape from yt-dlp with our --progress-template.
    let lines = [
        "AIO_PROGRESS|  10.0%| 1.00MiB/s|00:30|100000|1000000|1000000",
        "AIO_PROGRESS|  50.0%| 2.00MiB/s|00:10|500000|1000000|1000000",
        "AIO_PROGRESS| 100.0%| 2.00MiB/s|00:00|1000000|1000000|1000000",
    ];

    let mut percents = Vec::new();
    for line in lines {
        if let Some(delta) = driver.parse_line(line, &mut state) {
            if let Some(percent) = delta.percent {
                percents.push(percent);
            }
            assert_eq!(delta.total_bytes, Some(1_000_000));
        }
    }

    assert_eq!(percents, vec![10.0, 50.0, 100.0]);
}

#[test]
fn ytdlp_final_path_is_extracted() {
    let driver = driver_for(Backend::Ytdlp);
    let mut state = ParseState::default();

    let destination = driver
        .parse_line(
            "[download] Destination: /home/u/Downloads/a.mp4",
            &mut state,
        )
        .expect("destination line");
    assert_eq!(
        destination.output_path.as_deref(),
        Some("/home/u/Downloads/a.mp4")
    );

    // `--print after_move:filepath` output.
    let moved = driver
        .parse_line("/home/u/Downloads/a final.mp4", &mut state)
        .expect("after_move line");
    assert_eq!(
        moved.output_path.as_deref(),
        Some("/home/u/Downloads/a final.mp4")
    );
}

#[test]
fn aria2_fixture_stream_produces_speed_and_eta() {
    let driver = driver_for(Backend::Aria2);
    let mut state = ParseState::default();

    let delta = driver
        .parse_line(
            "[#2089b0 12MiB/34MiB(35%) CN:5 DL:1.2MiB ETA:18s]",
            &mut state,
        )
        .expect("summary line");

    assert_eq!(delta.percent, Some(35.0));
    assert_eq!(delta.total_bytes, Some(34 * 1024 * 1024));
    assert_eq!(delta.eta_seconds, Some(18));
    assert!(delta.speed_bytes_per_sec.unwrap_or(0.0) > 0.0);
}

#[test]
fn gallery_dl_fixture_counts_only_written_files() {
    let driver = driver_for(Backend::GalleryDl);
    let mut state = ParseState::default();

    // One new file, then one skipped file: the counter must stay at 1.
    let first = driver
        .parse_line("✔ /home/u/Downloads/123.jpg", &mut state)
        .expect("written file");
    assert_eq!(first.items_done, Some(1));

    let skipped = driver
        .parse_line("# /home/u/Downloads/123.jpg", &mut state)
        .expect("skipped file");
    assert_eq!(skipped.items_done, Some(1));
}

#[test]
fn spotdl_fixture_tracks_playlist_position() {
    let driver = driver_for(Backend::SpotDl);
    let mut state = ParseState::default();

    let found = driver
        .parse_line("Found 2 songs in playlist", &mut state)
        .expect("found line");
    assert_eq!(found.items_total, Some(2));

    let first = driver
        .parse_line("Downloaded \"A\" → /tmp/a.mp3", &mut state)
        .expect("first song");
    assert_eq!(first.items_done, Some(1));
    assert_eq!(first.percent, Some(50.0));

    let second = driver
        .parse_line("Downloaded \"B\" → /tmp/b.mp3", &mut state)
        .expect("second song");
    assert_eq!(second.items_done, Some(2));
    assert_eq!(second.percent, Some(100.0));
}

#[test]
fn unknown_lines_never_report_progress() {
    for backend in [
        Backend::Ytdlp,
        Backend::GalleryDl,
        Backend::Aria2,
        Backend::SpotDl,
    ] {
        let driver = driver_for(backend);
        let mut state = ParseState::default();
        assert!(
            driver
                .parse_line("just some unrelated log chatter", &mut state)
                .is_none(),
            "{:?} should ignore unrelated lines",
            backend
        );
    }
}
