import { describe, expect, it } from 'vitest'
import { DEFAULT_FORMAT_CHOICE, toFormatOverride } from './store'

describe('toFormatOverride', () => {
  it('sends nothing for the default choice', () => {
    expect(toFormatOverride(DEFAULT_FORMAT_CHOICE)).toBeUndefined()
  })

  it('maps a video preset to a format selector', () => {
    expect(
      toFormatOverride({ kind: 'preset', selector: 'bv*[height<=720]+ba/b[height<=720]' })
    ).toEqual({ format: 'bv*[height<=720]+ba/b[height<=720]' })
  })

  it('maps an audio choice to extract-audio fields', () => {
    expect(toFormatOverride({ kind: 'audio', audioFormat: 'flac' })).toEqual({
      audioOnly: true,
      audioFormat: 'flac',
    })
  })

  it('maps a custom choice to format plus container', () => {
    expect(
      toFormatOverride({ kind: 'custom', selector: 'bestvideo+bestaudio', container: 'mkv' })
    ).toEqual({ format: 'bestvideo+bestaudio', container: 'mkv' })
  })

  it('never sets audioOnly for video presets', () => {
    const mapped = toFormatOverride({ kind: 'preset', selector: 'bv*+ba/b' })
    expect(mapped?.audioOnly).toBeUndefined()
  })
})
