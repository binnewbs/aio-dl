import type { Backend } from './types'

/**
 * Backend routing.
 *
 * Precedence:
 *   1. Spotify / plain search text  -> spotDL
 *   2. Known gallery-site host      -> gallery-dl
 *   3. Direct file extension        -> aria2c
 *   4. Everything else              -> yt-dlp (broadest site support)
 *
 * `detectBackend` is pure and synchronous so the UI can badge the choice as you
 * type. Only genuinely ambiguous URLs fall through to `needsProbe`, which the
 * Rust side resolves with a HEAD request.
 */

/** Hosts gallery-dl supports that yt-dlp generally does not. */
const GALLERY_HOSTS = [
  'x.com',
  'twitter.com',
  'instagram.com',
  'pixiv.net',
  'danbooru.donmai.us',
  'e621.net',
  'reddit.com',
  'tumblr.com',
  'flickr.com',
  'deviantart.com',
  'artstation.com',
  'bsky.app',
  'newgrounds.com',
  'patreon.com',
  'mangadex.org',
  'imgur.com',
  'sankakucomplex.com',
  'pinterest.com',
  'weibo.com',
  'vk.com',
  'hentaifoundry.com',
  'fanbox.cc',
  'fantia.jp',
  'subscribestar.adult',
  'kemono.su',
  'kemono.party',
  'coomer.su',
  'coomer.party',
  'nitter.net',
  'booru.org',
]

const GALLERY_HOST_SUFFIXES = ['mastodon.', '.mastodon.']

const SPOTIFY_HOSTS = ['open.spotify.com', 'spotify.link', 'spoti.fi', 'play.spotify.com']

/** Archive/document/installer types that are definitely plain files. */
const FILE_EXTENSIONS = [
  'zip',
  '7z',
  'rar',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  'zst',
  'pdf',
  'epub',
  'mobi',
  'cbz',
  'cbr',
  'iso',
  'img',
  'deb',
  'rpm',
  'apk',
  'dmg',
  'exe',
  'msi',
  'bin',
  'torrent',
]

/** Raw media extensions that aria2c can fetch directly without extraction. */
const MEDIA_EXTENSIONS = [
  'mp4',
  'mkv',
  'webm',
  'mov',
  'avi',
  'flv',
  'm4v',
  'mp3',
  'flac',
  'm4a',
  'opus',
  'wav',
  'ogg',
  'aac',
  'm3u8',
]

export const ALL_EXTENSIONS = [...FILE_EXTENSIONS, ...MEDIA_EXTENSIONS]

export interface DetectionResult {
  backend: Backend
  /** Why this backend was chosen, for the UI tooltip/description. */
  reason: string
  /** True when a HEAD probe would give a better answer than the heuristics. */
  needsProbe: boolean
}

function safeUrl(input: string): URL | null {
  try {
    return new URL(input)
  } catch {
    return null
  }
}

/** Looks like a URL we can hand to a downloader. */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  if (/^https?:\/\//i.test(trimmed)) return true
  // Bare domains such as `youtu.be/abc` or `open.spotify.com/track/...`.
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(trimmed) && !/\s/.test(trimmed)) return true
  return false
}

/** Normalises user input into a URL string, adding https:// when needed. */
export function normalizeInput(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (looksLikeUrl(trimmed)) return `https://${trimmed}`
  return trimmed
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

function hostMatches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`)
}

/** Returns the lowercase extension of the URL path, if any. */
export function extensionOf(input: string): string | null {
  const url = safeUrl(input)
  const path = url ? url.pathname : input.split(/[?#]/)[0]
  const last = path.split('/').filter(Boolean).pop() ?? ''
  const dot = last.lastIndexOf('.')
  if (dot <= 0 || dot === last.length - 1) return null
  return last.slice(dot + 1).toLowerCase()
}

function isFileLikeQuery(url: URL): boolean {
  // e.g. `?filename=report.zip` or `?f=video.mp4`
  for (const [, value] of url.searchParams) {
    const ext = extensionOf(value)
    if (ext && ALL_EXTENSIONS.includes(ext)) return true
  }
  return false
}

export function isSpotifyUrl(input: string): boolean {
  const url = safeUrl(normalizeInput(input))
  if (!url) return false
  const host = hostOf(url)
  return SPOTIFY_HOSTS.some((candidate) => hostMatches(host, candidate))
}

export function isGalleryUrl(input: string): boolean {
  const url = safeUrl(normalizeInput(input))
  if (!url) return false
  const host = hostOf(url)
  if (GALLERY_HOSTS.some((candidate) => hostMatches(host, candidate))) return true
  if (GALLERY_HOST_SUFFIXES.some((suffix) => host.includes(suffix))) return true
  return false
}

export function isDirectFileUrl(input: string): boolean {
  const normalized = normalizeInput(input)
  const url = safeUrl(normalized)
  if (!url) return false
  const ext = extensionOf(normalized)
  if (ext && ALL_EXTENSIONS.includes(ext)) return true
  return isFileLikeQuery(url)
}

/** Picks a backend using only the URL text. */
export function detectBackend(input: string): DetectionResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return { backend: 'ytdlp', reason: 'Waiting for a URL', needsProbe: false }
  }

  // Plain text with no URL shape is a spotDL search query.
  if (!looksLikeUrl(trimmed)) {
    return {
      backend: 'spotDl',
      reason: 'Search text — spotDL will look it up',
      needsProbe: false,
    }
  }

  if (isSpotifyUrl(trimmed)) {
    return { backend: 'spotDl', reason: 'Spotify link', needsProbe: false }
  }

  if (isGalleryUrl(trimmed)) {
    return { backend: 'galleryDl', reason: 'Image/gallery site', needsProbe: false }
  }

  if (isDirectFileUrl(trimmed)) {
    return { backend: 'aria2', reason: 'Direct file link', needsProbe: false }
  }

  const url = safeUrl(normalizeInput(trimmed))
  if (url) {
    const ext = extensionOf(trimmed)
    // Extensions that mean "this is a web page / endpoint", never a file.
    const WEB_EXTENSIONS = ['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'do', 'action', 'cgi']
    if (ext && !WEB_EXTENSIONS.includes(ext)) {
      return {
        backend: 'aria2',
        reason: `Unknown .${ext} file — will verify with the server`,
        needsProbe: true,
      }
    }
  }

  return {
    backend: 'ytdlp',
    reason: 'Video/audio site handled by yt-dlp',
    needsProbe: false,
  }
}

/**
 * Refines detection with a HEAD probe result. Used when `needsProbe` was true
 * or when the user asks the app to double-check a direct-file guess.
 */
export function refineWithProbe(
  detection: DetectionResult,
  probe: {
    ok: boolean
    isHtml: boolean
    contentLength: number | null
    contentType: string | null
  } | null
): DetectionResult {
  if (!probe || !probe.ok) return detection

  const isBinary = !probe.isHtml
  const hasSize = (probe.contentLength ?? 0) > 0

  if (detection.needsProbe) {
    if (isBinary && hasSize) {
      return { ...detection, backend: 'aria2', reason: 'Server confirmed a direct file', needsProbe: false }
    }
    return {
      ...detection,
      backend: 'ytdlp',
      reason: 'Server returned a web page — using yt-dlp',
      needsProbe: false,
    }
  }

  // A page that turns out to be a raw media stream is better handled by aria2c.
  if (detection.backend === 'ytdlp' && isBinary && hasSize) {
    return { ...detection, backend: 'aria2', reason: 'Direct media stream', needsProbe: false }
  }

  return detection
}
