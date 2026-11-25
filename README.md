# aio-dl

A desktop GUI that wraps **yt-dlp**, **gallery-dl**, **aria2c**, and **spotDL** behind one paste-a-link
box. Drop in a URL, aio-dl picks the right backend automatically, and downloads it with live
progress, a queue, history, and a health panel for the bundled engines.

Built with **Tauri 2 + React 19 + TypeScript** and **shadcn/ui** (preset `buFyyjQ`, `lyra` style).

---

## How routing works

Detection runs in the UI as you type, so the backend badge updates instantly. Only genuinely
ambiguous URLs get an HTTP `HEAD` probe from Rust.

| Order | Condition | Backend |
| --- | --- | --- |
| 1 | `open.spotify.com`, `spoti.fi`, `spotify.link`, **or plain text** | **spotDL** |
| 2 | Known image/gallery host (`x.com`, `pixiv.net`, `instagram.com`, `danbooru`, …) | **gallery-dl** |
| 3 | Path ends in an archive/document/media extension, or a file-like query param | **aria2c** |
| 4 | Unknown extension | **aria2c** (after a server probe) |
| 5 | Anything else | **yt-dlp** |

You can always override the choice with the backend dropdown before starting a download.

---

## Requirements

- **Node.js 20+** and npm
- **Rust 1.90+** (`rustc`, `cargo`)
- **Python 3.10+** — only to *build* the bundled gallery-dl binary
- Linux: `webkit2gtk-4.1`, `gtk3`, `librsvg2`, `libsoup3`

---

## Getting started

```bash
npm install
npm run sidecars     # downloads/builds all five engines into src-tauri/binaries/
npm run tauri dev
```

`npm run sidecars` is idempotent; add `--force` to refetch, or
`--only=yt-dlp,ffmpeg` to fetch a subset.

### What it fetches

| Binary | Source | Notes |
| --- | --- | --- |
| `yt-dlp` | GitHub release `2026.11.23` | PyInstaller build, no Python needed at runtime |
| `aria2c` | `abcfy2/aria2-static-build` `1.37.0` | static musl/mingw build |
| `spotdl` | GitHub release `v4.6.0` | standalone per-platform binary |
| `ffmpeg` | `ffmpeg-static` devDependency | copied from `node_modules` |
| `gallery-dl` | **built locally** with PyInstaller | uses gallery-dl's official hook |

Binaries are written as `src-tauri/binaries/<name>-<target-triple>` and are gitignored.

Overrides when a platform asset is unavailable:

```bash
ARIA2_PATH="$(command -v aria2c)" node scripts/fetch-sidecars.mjs
FFMPEG_PATH=/usr/bin/ffmpeg       node scripts/fetch-sidecars.mjs
YTDLP_PATH=/usr/local/bin/yt-dlp  node scripts/fetch-sidecars.mjs
```

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server only |
| `npm run tauri dev` | Run the desktop app with hot reload |
| `npm run build` | Typecheck and build the frontend |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm test` | Frontend unit tests (backend routing, formatting) |
| `npm run sidecars` | Fetch/build the five bundled engines |
| `npm run tauri build` | Produce installers (deb/rpm/AppImage on Linux) |

Rust tests live in `src-tauri`:

```bash
cd src-tauri && cargo test        # parsers, safety, pipeline fixtures
cd src-tauri && cargo clippy      # lints
```

---

## Using the app

- **Downloads** — paste a link (or a song name), press `Enter`. `Ctrl/⌘+Enter` submits from
  anywhere. Each job shows a live percentage, speed, ETA, or item count depending on the backend.
- **Job actions** — open the containing folder, retry a finished job, or cancel a running one.
- **History** — every finished job, filterable by outcome, with re-download and remove actions.
- **Doctor** — runs `--version` on all five engines and reports anything missing with an install
  hint. Downloads routed to a missing engine fail with a clear message instead of hanging.
- **Settings** — output directory, concurrency, retries, cookies file, yt-dlp format and
  audio-extraction options, spotDL format and bitrate, aria2c connection count, and per-backend
  extra arguments.

### Progress sources per backend

| Backend | Progress reported |
| --- | --- |
| yt-dlp | real percentage, speed, ETA, final file path |
| aria2c | real percentage, speed, ETA from the summary line |
| gallery-dl | file count (`✔` written, `#` skipped — not counted) |
| spotDL | songs completed out of the playlist total |

---

## Architecture

```
React UI ──invoke/events──▶ Rust core ──sidecar spawn──▶ yt-dlp / gallery-dl / aria2c / spotdl
                              │
                              ├─ TS: pure URL routing + unit tests
                              ├─ Rust: HEAD probe for ambiguous URLs
                              ├─ Rust: job scheduler (concurrency, cancel, retry)
                              ├─ Rust: per-backend stdout parsers (unit tested)
                              └─ JSON settings + history in the app data dir
```

Key files:

- `src/lib/detect.ts` — backend routing rules (25 unit tests)
- `src-tauri/src/backends.rs` — argv builders and output parsers per backend
- `src-tauri/src/jobs.rs` — queue, concurrency limit, cancellation, history writes
- `src-tauri/src/binaries.rs` — sidecar resolution and health checks

Security notes:

- All sidecars are spawned **from Rust**; the webview has no shell permissions.
- URLs are passed as argv entries after `--`, so a URL can never be parsed as a flag.
- spotDL is the exception: its CLI (argparse) has no `--` separator, so queries that
  begin with `-` are prefixed with a space and treated as search text.
- Binaries are never fetched at runtime.

---

## Licensing

The app code is MIT (see `LICENSE`). The **bundled binaries carry their own licenses**:

- **aria2c** — GPLv2+
- **ffmpeg** (`ffmpeg-static`) — GPL build
- **yt-dlp** — Unlicense (bundled build includes other components)
- **gallery-dl** — GPLv2
- **spotDL** — MIT

Redistributing a bundle that contains GPL-licensed engines means the distributed work must
comply with the GPL. If that matters for your distribution, either ship the corresponding
source/notices or run `npm run sidecars` on the user's machine instead of bundling.
