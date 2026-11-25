import { describe, expect, it } from 'vitest'
import {
  detectBackend,
  extensionOf,
  isDirectFileUrl,
  isGalleryUrl,
  isSpotifyUrl,
  looksLikeUrl,
  normalizeInput,
  refineWithProbe,
} from './detect'

describe('looksLikeUrl / normalizeInput', () => {
  it('accepts full URLs', () => {
    expect(looksLikeUrl('https://example.com/a')).toBe(true)
    expect(looksLikeUrl('http://example.com')).toBe(true)
  })

  it('accepts bare domains', () => {
    expect(looksLikeUrl('youtu.be/abc123')).toBe(true)
    expect(looksLikeUrl('open.spotify.com/track/x')).toBe(true)
  })

  it('rejects plain search text', () => {
    expect(looksLikeUrl('The Weeknd - Blinding Lights')).toBe(false)
    expect(looksLikeUrl('')).toBe(false)
    expect(looksLikeUrl('   ')).toBe(false)
  })

  it('adds a scheme only to URL-shaped input', () => {
    expect(normalizeInput('youtu.be/abc')).toBe('https://youtu.be/abc')
    expect(normalizeInput('https://already.dev/x')).toBe('https://already.dev/x')
    expect(normalizeInput('some song name')).toBe('some song name')
    expect(normalizeInput('')).toBe('')
  })
})

describe('extensionOf', () => {
  it('reads the path extension', () => {
    expect(extensionOf('https://x.dev/a/report.ZIP')).toBe('zip')
    expect(extensionOf('https://x.dev/a/b/c.mp4?token=1')).toBe('mp4')
  })

  it('returns null when there is no extension', () => {
    expect(extensionOf('https://x.dev/watch')).toBeNull()
    expect(extensionOf('https://x.dev/')).toBeNull()
    expect(extensionOf('https://x.dev/a.tar.gz')).toBe('gz')
  })
})

describe('spotify detection', () => {
  it('matches spotify hosts', () => {
    expect(isSpotifyUrl('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b')).toBe(true)
    expect(isSpotifyUrl('https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj')).toBe(true)
    expect(isSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1E8UXBoz02kGID')).toBe(true)
    expect(isSpotifyUrl('https://open.spotify.com/intl-de/track/xyz')).toBe(true)
    expect(isSpotifyUrl('https://spoti.fi/abc')).toBe(true)
    expect(isSpotifyUrl('https://spotify.link/abc')).toBe(true)
  })

  it('does not match other hosts', () => {
    expect(isSpotifyUrl('https://youtube.com/watch?v=x')).toBe(false)
    expect(isSpotifyUrl('https://notspotify.com/track/x')).toBe(false)
  })
})

describe('gallery detection', () => {
  it('matches known gallery hosts', () => {
    expect(isGalleryUrl('https://x.com/user/status/123')).toBe(true)
    expect(isGalleryUrl('https://twitter.com/user/status/123')).toBe(true)
    expect(isGalleryUrl('https://www.instagram.com/p/abc/')).toBe(true)
    expect(isGalleryUrl('https://www.pixiv.net/artworks/12345')).toBe(true)
    expect(isGalleryUrl('https://danbooru.donmai.us/posts/123')).toBe(true)
    expect(isGalleryUrl('https://www.reddit.com/r/pics/comments/x/y/')).toBe(true)
    expect(isGalleryUrl('https://bsky.app/profile/a.bsky.social/post/1')).toBe(true)
    expect(isGalleryUrl('https://kemono.su/patreon/user/123')).toBe(true)
    expect(isGalleryUrl('https://mastodon.social/@user/123')).toBe(true)
  })

  it('does not match video sites', () => {
    expect(isGalleryUrl('https://youtube.com/watch?v=x')).toBe(false)
    expect(isGalleryUrl('https://vimeo.com/123')).toBe(false)
  })
})

describe('direct file detection', () => {
  it('matches archive and document extensions', () => {
    expect(isDirectFileUrl('https://example.com/file.zip')).toBe(true)
    expect(isDirectFileUrl('https://example.com/docs/manual.pdf')).toBe(true)
    expect(isDirectFileUrl('https://example.com/os.iso')).toBe(true)
    expect(isDirectFileUrl('https://example.com/app.deb')).toBe(true)
  })

  it('matches raw media extensions', () => {
    expect(isDirectFileUrl('https://cdn.example.com/clip.mp4')).toBe(true)
    expect(isDirectFileUrl('https://cdn.example.com/song.flac')).toBe(true)
    expect(isDirectFileUrl('https://cdn.example.com/audio.opus')).toBe(true)
  })

  it('matches file-like query parameters', () => {
    expect(isDirectFileUrl('https://example.com/get?filename=report.zip')).toBe(true)
    expect(isDirectFileUrl('https://example.com/dl?f=clip.mp4&x=1')).toBe(true)
  })

  it('does not match ordinary pages', () => {
    expect(isDirectFileUrl('https://youtube.com/watch?v=x')).toBe(false)
    expect(isDirectFileUrl('https://example.com/about')).toBe(false)
  })
})

describe('detectBackend routing', () => {
  it('routes Spotify to spotDL', () => {
    expect(detectBackend('https://open.spotify.com/track/abc').backend).toBe('spotDl')
  })

  it('routes plain text to spotDL search', () => {
    const result = detectBackend('The Weeknd - Blinding Lights')
    expect(result.backend).toBe('spotDl')
    expect(result.needsProbe).toBe(false)
  })

  it('routes gallery sites to gallery-dl', () => {
    expect(detectBackend('https://x.com/u/status/1').backend).toBe('galleryDl')
    expect(detectBackend('https://www.pixiv.net/artworks/1').backend).toBe('galleryDl')
  })

  it('routes direct files to aria2c', () => {
    expect(detectBackend('https://example.com/a.zip').backend).toBe('aria2')
    expect(detectBackend('https://cdn.example.com/v.mp4').backend).toBe('aria2')
  })

  it('routes video sites to yt-dlp', () => {
    expect(detectBackend('https://www.youtube.com/watch?v=abc').backend).toBe('ytdlp')
    expect(detectBackend('https://vimeo.com/123456').backend).toBe('ytdlp')
    expect(detectBackend('https://www.twitch.tv/videos/123').backend).toBe('ytdlp')
  })

  it('routes unknown extensions to aria2c with a probe', () => {
    const result = detectBackend('https://example.com/data.unknownext')
    expect(result.backend).toBe('aria2')
    expect(result.needsProbe).toBe(true)
  })

  it('reports an empty input as pending', () => {
    const result = detectBackend('')
    expect(result.reason).toMatch(/waiting/i)
  })
})

describe('refineWithProbe', () => {
  it('confirms a direct file when the server returns binary content', () => {
    const base = detectBackend('https://example.com/data.unknownext')
    const refined = refineWithProbe(base, {
      ok: true,
      isHtml: false,
      contentLength: 1024,
      contentType: 'application/octet-stream',
    })
    expect(refined.backend).toBe('aria2')
    expect(refined.needsProbe).toBe(false)
  })

  it('falls back to yt-dlp when the server returns HTML', () => {
    const base = detectBackend('https://example.com/data.unknownext')
    const refined = refineWithProbe(base, {
      ok: true,
      isHtml: true,
      contentLength: 5000,
      contentType: 'text/html; charset=utf-8',
    })
    expect(refined.backend).toBe('ytdlp')
  })

  it('leaves detection untouched when the probe fails', () => {
    const base = detectBackend('https://example.com/a.zip')
    expect(refineWithProbe(base, null)).toBe(base)
    expect(
      refineWithProbe(base, { ok: false, isHtml: false, contentLength: null, contentType: null })
    ).toBe(base)
  })

  it('upgrades a page that is really a media stream', () => {
    const base = detectBackend('https://cdn.example.com/stream')
    expect(base.backend).toBe('ytdlp')
    const refined = refineWithProbe(base, {
      ok: true,
      isHtml: false,
      contentLength: 10_000_000,
      contentType: 'video/mp4',
    })
    expect(refined.backend).toBe('aria2')
  })
})
