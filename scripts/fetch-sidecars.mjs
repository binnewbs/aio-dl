#!/usr/bin/env node
// Fetches (or builds) the five sidecar binaries that aio-dl bundles.
//
// Each binary is written to src-tauri/binaries/<name>-<target-triple>[.exe]
// so Tauri's `externalBin` bundling can find it.
//
// Usage:
//   node scripts/fetch-sidecars.mjs [--force] [--only=yt-dlp,aria2c]
//
// Environment overrides:
//   FFMPEG_PATH   use an existing ffmpeg binary instead of ffmpeg-static
//   ARIA2_PATH    use an existing aria2c binary (needed on macOS)
//   YTDLP_PATH, GALLERYDL_PATH, SPOTDL_PATH  same idea for the others

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'src-tauri', 'binaries')
const CACHE_DIR = path.join(ROOT, '.sidecar-cache')
const VENV_DIR = path.join(ROOT, '.venv-sidecar')

export const PINNED = {
  ytDlp: '2026.11.23',
  galleryDl: '1.32.21',
  spotdl: '4.6.0',
  aria2: '1.37.0',
}

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const onlyArg = args.find((a) => a.startsWith('--only='))
const ONLY = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null

const isWindows = process.platform === 'win32'
const exeSuffix = isWindows ? '.exe' : ''

function log(msg) {
  process.stdout.write(`${msg}\n`)
}

function fail(msg) {
  process.stderr.write(`\nERROR: ${msg}\n`)
  process.exit(1)
}

function hostTriple() {
  try {
    return execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim()
  } catch {
    try {
      const out = execFileSync('rustc', ['-Vv'], { encoding: 'utf8' })
      const host = out.split('\n').find((l) => l.startsWith('host:'))
      if (!host) throw new Error('no host line')
      return host.split(' ')[1].trim()
    } catch {
      fail('Could not determine the target triple. Is rustc installed and on PATH?')
    }
  }
}

/** Maps a host triple to the platform/arch tokens used by upstream release assets. */
export function platformOf(triple) {
  const arch = triple.startsWith('aarch64') || triple.startsWith('arm64')
    ? 'arm64'
    : triple.startsWith('i686') || triple.startsWith('i586')
      ? 'x86'
      : 'x64'

  const osName = triple.includes('windows')
    ? 'windows'
    : triple.includes('darwin')
      ? 'macos'
      : triple.includes('linux')
        ? 'linux'
        : null

  if (!osName) fail(`Unsupported host triple: ${triple}`)
  return { os: osName, arch }
}

async function download(url, dest, { quiet = false } = {}) {
  if (!quiet) log(`    downloading ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buf)
  return dest
}

function chmodX(file) {
  if (!isWindows) fs.chmodSync(file, 0o755)
}

function unzip(zipPath, member, destFile) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aio-dl-unzip-'))
  try {
    execFileSync('unzip', ['-o', '-q', zipPath, member, '-d', tmpDir])
    const found = path.join(tmpDir, member)
    if (!fs.existsSync(found)) throw new Error(`${member} not found inside ${zipPath}`)
    fs.copyFileSync(found, destFile)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

function targetPath(name) {
  return path.join(OUT_DIR, `${name}-${HOST_TRIPLE}${exeSuffix}`)
}

function alreadyThere(name) {
  const dest = targetPath(name)
  if (!FORCE && fs.existsSync(dest)) {
    log(`  ${name}: already present, skipping (use --force to refetch)`)
    return true
  }
  return false
}

function useOverride(name, envVar) {
  const override = process.env[envVar]
  if (!override) return false
  if (!fs.existsSync(override)) fail(`${envVar} points at ${override}, which does not exist`)
  const dest = targetPath(name)
  fs.copyFileSync(override, dest)
  chmodX(dest)
  log(`  ${name}: copied from ${envVar} (${override})`)
  return true
}

// ---------------------------------------------------------------------------
// yt-dlp: upstream publishes PyInstaller binaries (no Python needed at runtime)
// ---------------------------------------------------------------------------
async function fetchYtDlp() {
  if (alreadyThere('yt-dlp') || useOverride('yt-dlp', 'YTDLP_PATH')) return

  const { os: osName, arch } = PLATFORM
  const tag = PINNED.ytDlp
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}`

  const asset = {
    linux: { x64: 'yt-dlp_linux', arm64: 'yt-dlp_linux_aarch64', x86: null },
    macos: { x64: 'yt-dlp_macos', arm64: 'yt-dlp_macos', x86: null },
    windows: { x64: 'yt-dlp.exe', arm64: 'yt-dlp_arm64.exe', x86: 'yt-dlp_x86.exe' },
  }[osName][arch]

  if (!asset) fail(`No yt-dlp build published for ${osName}/${arch}.`)

  const dest = targetPath('yt-dlp')
  await download(`${base}/${asset}`, dest)
  chmodX(dest)
  log(`  yt-dlp: ${asset} -> ${path.relative(ROOT, dest)}`)
}

// ---------------------------------------------------------------------------
// aria2c: abcfy2 static musl/mingw builds (Linux + Windows). macOS has none.
// ---------------------------------------------------------------------------
async function fetchAria2() {
  if (alreadyThere('aria2c') || useOverride('aria2c', 'ARIA2_PATH')) return

  const { os: osName, arch } = PLATFORM
  if (osName === 'macos') {
    fail(
      'No prebuilt static aria2c exists for macOS.\n' +
        '       Install one (brew install aria2) and re-run with:\n' +
        '         ARIA2_PATH="$(command -v aria2c)" node scripts/fetch-sidecars.mjs'
    )
  }

  const tag = PINNED.aria2
  const base = `https://github.com/abcfy2/aria2-static-build/releases/download/${tag}`

  const asset = {
    linux: {
      x64: 'aria2-x86_64-linux-musl_static.zip',
      arm64: 'aria2-aarch64-linux-musl_static.zip',
      x86: 'aria2-i686-linux-musl_static.zip',
    },
    windows: {
      x64: 'aria2-x86_64-w64-mingw32_static.zip',
      arm64: null,
      x86: 'aria2-i686-w64-mingw32_static.zip',
    },
  }[osName]?.[arch]

  if (!asset) fail(`No static aria2c build for ${osName}/${arch}.`)

  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const zipPath = path.join(CACHE_DIR, asset)
  if (FORCE || !fs.existsSync(zipPath)) await download(`${base}/${asset}`, zipPath)

  const member = osName === 'windows' ? 'aria2c.exe' : 'aria2c'
  const dest = targetPath('aria2c')
  unzip(zipPath, member, dest)
  chmodX(dest)
  log(`  aria2c: ${asset} -> ${path.relative(ROOT, dest)}`)
}

// ---------------------------------------------------------------------------
// spotDL: upstream publishes standalone binaries per platform
// ---------------------------------------------------------------------------
async function fetchSpotDl() {
  if (alreadyThere('spotdl') || useOverride('spotdl', 'SPOTDL_PATH')) return

  const { os: osName } = PLATFORM
  const tag = `v${PINNED.spotdl}`
  const base = `https://github.com/spotDL/spotify-downloader/releases/download/${tag}`

  const asset = {
    linux: `spotdl-${PINNED.spotdl}-linux`,
    macos: `spotdl-${PINNED.spotdl}-darwin`,
    windows: `spotdl-${PINNED.spotdl}-win32.exe`,
  }[osName]

  const dest = targetPath('spotdl')
  await download(`${base}/${asset}`, dest)
  chmodX(dest)
  log(`  spotdl: ${asset} -> ${path.relative(ROOT, dest)}`)
}

// ---------------------------------------------------------------------------
// gallery-dl: pure Python, no upstream executables. Build a onefile binary
// with PyInstaller (uses gallery-dl's own packaging recipe).
// ---------------------------------------------------------------------------
async function fetchGalleryDl() {
  if (alreadyThere('gallery-dl') || useOverride('gallery-dl', 'GALLERYDL_PATH')) return

  const venvPython = isWindows
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python')

  if (!fs.existsSync(venvPython)) {
    log('    creating build virtualenv (.venv-sidecar)')
    const bootstrap = spawnSync('python3', ['-m', 'venv', VENV_DIR], { stdio: 'inherit' })
    if (bootstrap.status !== 0) {
      fail('Could not create a Python virtualenv. Python 3.10+ is required to build gallery-dl.')
    }
  }

  log(`    installing gallery-dl ${PINNED.galleryDl} + pyinstaller into the build virtualenv`)
  const pip = spawnSync(
    venvPython,
    ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip', `gallery-dl==${PINNED.galleryDl}`, 'pyinstaller'],
    { stdio: 'inherit' }
  )
  if (pip.status !== 0) fail('pip install failed while preparing the gallery-dl build.')

  // Same flags as gallery-dl's own scripts/pyinstaller.py, including its
  // PyInstaller hook. Without the hook, frozen builds fail to import
  // extractor modules whose names start with a digit (e.g. `2ch`).
  const workDir = path.join(CACHE_DIR, 'gallery-dl-build')
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })

  const hooksDir = path.join(workDir, 'hooks')
  fs.mkdirSync(hooksDir, { recursive: true })
  const hookPath = path.join(hooksDir, 'hook-gallery_dl.py')
  if (!fs.existsSync(hookPath)) {
    log('    downloading gallery-dl PyInstaller hook')
    await download(
      'https://raw.githubusercontent.com/mikf/gallery-dl/master/scripts/hook-gallery_dl.py',
      hookPath
    )
  }

  log('    running PyInstaller (this takes a few minutes)')
  const entry = execFileSync(
    venvPython,
    ['-c', 'import gallery_dl, os; print(os.path.join(os.path.dirname(gallery_dl.__file__), "__main__.py"))'],
    { encoding: 'utf8' }
  ).trim()
  if (!fs.existsSync(entry)) fail(`gallery_dl entry point missing at ${entry}`)

  const build = spawnSync(
    venvPython,
    [
      '-m',
      'PyInstaller',
      '--onefile',
      '--console',
      '--name',
      'gallery-dl',
      '--exclude-module',
      'pkg_resources',
      '--additional-hooks-dir',
      hooksDir,
      '--distpath',
      workDir,
      '--workpath',
      path.join(workDir, 'build'),
      '--specpath',
      path.join(workDir, 'build'),
      entry,
    ],
    { stdio: 'inherit', cwd: workDir }
  )
  if (build.status !== 0) fail('PyInstaller failed to build gallery-dl.')

  const built = path.join(workDir, `gallery-dl${exeSuffix}`)
  if (!fs.existsSync(built)) fail(`PyInstaller did not produce ${built}`)

  const dest = targetPath('gallery-dl')
  fs.copyFileSync(built, dest)
  chmodX(dest)
  log(`  gallery-dl: built -> ${path.relative(ROOT, dest)}`)
}

// ---------------------------------------------------------------------------
// ffmpeg: reuse the ffmpeg-static devDependency binary, or FFMPEG_PATH
// ---------------------------------------------------------------------------
async function fetchFfmpeg() {
  if (alreadyThere('ffmpeg') || useOverride('ffmpeg', 'FFMPEG_PATH')) return

  let source = null
  try {
    const mod = await import('ffmpeg-static')
    source = mod.default
  } catch {
    source = null
  }

  if (!source || !fs.existsSync(source)) {
    fail(
      'Could not resolve the ffmpeg-static binary.\n' +
        '       Run `npm install` (and `npm rebuild ffmpeg-static`) or pass:\n' +
        '         FFMPEG_PATH=/path/to/ffmpeg node scripts/fetch-sidecars.mjs'
    )
  }

  const dest = targetPath('ffmpeg')
  fs.copyFileSync(source, dest)
  chmodX(dest)
  log(`  ffmpeg: ${path.relative(ROOT, source)} -> ${path.relative(ROOT, dest)}`)
}

// ---------------------------------------------------------------------------

const HOST_TRIPLE = hostTriple()
const PLATFORM = platformOf(HOST_TRIPLE)

const TASKS = {
  'yt-dlp': fetchYtDlp,
  'gallery-dl': fetchGalleryDl,
  aria2c: fetchAria2,
  spotdl: fetchSpotDl,
  ffmpeg: fetchFfmpeg,
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  log(`aio-dl sidecars  (host ${HOST_TRIPLE})`)
  log(`output: ${path.relative(ROOT, OUT_DIR)}${path.sep}\n`)

  for (const [name, fn] of Object.entries(TASKS)) {
    if (ONLY && !ONLY.includes(name)) continue
    await fn()
  }

  log('\nSummary:')
  let missing = 0
  for (const name of Object.keys(TASKS)) {
    if (ONLY && !ONLY.includes(name)) continue
    const p = targetPath(name)
    if (!fs.existsSync(p)) {
      log(`  MISSING  ${name}`)
      missing++
      continue
    }
    const mb = (fs.statSync(p).size / (1024 * 1024)).toFixed(1)
    log(`  ok       ${name.padEnd(11)} ${mb.padStart(6)} MB  ${path.relative(ROOT, p)}`)
  }

  if (missing > 0) {
    fail(`${missing} sidecar(s) are missing. Fix the errors above and re-run.`)
  }
  log('\nAll sidecars ready.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(err?.stack || String(err)))
}
