import { describe, expect, it } from 'vitest'
import { formatBytes, formatCount, formatEta, formatSpeed, shortUrl } from './format'

describe('formatBytes', () => {
  it('formats byte scales', () => {
    expect(formatBytes(0)).toBe('—')
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.00 KiB')
    expect(formatBytes(1536)).toBe('1.50 KiB')
    expect(formatBytes(1024 * 1024)).toBe('1.00 MiB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GiB')
  })

  it('drops decimals for large values', () => {
    expect(formatBytes(1024 * 1024 * 150)).toBe('150 MiB')
    expect(formatBytes(1024 * 25)).toBe('25.0 KiB')
  })
})

describe('formatSpeed', () => {
  it('appends a rate suffix', () => {
    expect(formatSpeed(1024)).toBe('1.00 KiB/s')
    expect(formatSpeed(0)).toBe('—')
    expect(formatSpeed(null)).toBe('—')
  })
})

describe('formatEta', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatEta(45)).toBe('45s')
    expect(formatEta(90)).toBe('1m 30s')
    expect(formatEta(3723)).toBe('1h 02m')
    expect(formatEta(null)).toBe('—')
    expect(formatEta(-5)).toBe('—')
  })
})

describe('formatCount', () => {
  it('shows a ratio when a total is known', () => {
    expect(formatCount(3, 10)).toBe('3/10')
    expect(formatCount(3, null)).toBe('3')
    expect(formatCount(0, 0)).toBe('0')
  })
})

describe('shortUrl', () => {
  it('truncates long labels', () => {
    const long = 'https://example.com/' + 'a'.repeat(100)
    expect(shortUrl(long, 20).length).toBeLessThanOrEqual(20)
    expect(shortUrl(long, 20).endsWith('…')).toBe(true)
    expect(shortUrl('short', 20)).toBe('short')
  })
})
