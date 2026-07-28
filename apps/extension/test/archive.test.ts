import { describe, expect, it } from 'vitest'
import { parseCdxTimestamp, readCdx } from '../lib/archive.js'

describe('CDX timestamps', () => {
  it('reads the archive’s YYYYMMDDhhmmss into an instant', () => {
    expect(parseCdxTimestamp('20140312093015')).toBe('2014-03-12T09:30:15Z')
  })

  it('rejects anything that is not one', () => {
    expect(parseCdxTimestamp('2014')).toBeNull()
    expect(parseCdxTimestamp('20149999999999')).toBeNull()
    expect(parseCdxTimestamp('')).toBeNull()
  })
})

describe('reading a capture list', () => {
  const rows = (...stamps: string[]) => [
    ['timestamp', 'digest'],
    ...stamps.map((stamp, i) => [stamp, `DIGEST${i}`]),
  ]

  it('treats the last collapsed capture as the most recent edit', () => {
    const lookup = readCdx(rows('20140312093015', '20190101000000', '20230104120000'))
    expect(lookup?.firstCapture).toBe('2014-03-12T09:30:15Z')
    expect(lookup?.lastEdit).toBe('2023-01-04T12:00:00Z')
  })

  it('reports no edit when the page was only ever captured once', () => {
    // The first capture is the page appearing, not changing.
    const lookup = readCdx(rows('20140312093015'))
    expect(lookup?.firstCapture).toBe('2014-03-12T09:30:15Z')
    expect(lookup?.lastEdit).toBeUndefined()
  })

  it('returns nothing for an empty or malformed response', () => {
    expect(readCdx([['timestamp', 'digest']])).toBeNull()
    expect(readCdx([])).toBeNull()
    expect(readCdx(null)).toBeNull()
    expect(readCdx({ error: 'rate limited' })).toBeNull()
  })

  it('skips rows it cannot read rather than failing the whole lookup', () => {
    const lookup = readCdx([
      ['timestamp', 'digest'],
      ['garbage', 'A'],
      ['20230104120000', 'B'],
      ['20240104120000', 'C'],
    ])
    expect(lookup?.lastEdit).toBe('2024-01-04T12:00:00Z')
  })
})
