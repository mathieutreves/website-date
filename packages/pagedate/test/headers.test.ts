import { describe, expect, it } from 'vitest'
import { findDates } from '../src/index.js'
import { extractHttpHeaders } from '../src/extract/headers.js'
import { documentFrom, NOW, strictEnv } from './helpers.js'

const PAGE_URL = 'https://example.com/post/'

describe('Last-Modified header', () => {
  it('reads a modification date that predates the response', () => {
    const found = extractHttpHeaders(
      {
        date: 'Tue, 28 Jul 2026 08:38:34 GMT',
        'last-modified': 'Fri, 17 Jul 2026 18:38:36 GMT',
      },
      NOW,
    )

    expect(found).toHaveLength(1)
    expect(found[0]?.value).toBe('2026-07-17T18:38Z')
    expect(found[0]?.field).toBe('modified')
    // Never better than a guess: on a CDN this is the file the edge happened to
    // hold, not a statement about the writing.
    expect(found[0]?.confidence).toBe('inferred')
  })

  it('discards a Last-Modified that is really the serve time', () => {
    // Cloudflare in front of a static site: the two are 48 seconds apart.
    const found = extractHttpHeaders(
      {
        date: 'Tue, 28 Jul 2026 08:35:52 GMT',
        'last-modified': 'Tue, 28 Jul 2026 08:35:04 GMT',
      },
      NOW,
    )

    expect(found).toEqual([])
  })

  it('falls back to the clock when the server sent no Date', () => {
    const found = extractHttpHeaders(
      { 'last-modified': new Date(NOW.getTime() - 30_000).toUTCString() },
      NOW,
    )

    expect(found).toEqual([])
  })

  it('discards a response that says it must not be cached', () => {
    const headers = {
      date: 'Tue, 28 Jul 2026 08:38:34 GMT',
      'last-modified': 'Fri, 17 Jul 2026 18:38:36 GMT',
      'cache-control': 'private, no-store, max-age=0',
    }

    expect(extractHttpHeaders(headers, NOW)).toEqual([])
  })

  it('discards a response that sets a cookie while serving itself', () => {
    const headers = {
      date: 'Tue, 28 Jul 2026 08:38:34 GMT',
      'last-modified': 'Fri, 17 Jul 2026 18:38:36 GMT',
      'set-cookie': 'sessionid=abc; Path=/',
    }

    expect(extractHttpHeaders(headers, NOW)).toEqual([])
  })

  it('does not care how the caller cased the header names', () => {
    const found = extractHttpHeaders(
      { Date: 'Tue, 28 Jul 2026 08:38:34 GMT', 'Last-Modified': 'Wed, 01 Jul 2026 10:00:00 GMT' },
      NOW,
    )

    expect(found[0]?.value).toBe('2026-07-01T10:00Z')
  })
})

describe('Last-Modified in the pipeline', () => {
  const headers = {
    [PAGE_URL]: {
      date: 'Tue, 28 Jul 2026 08:38:34 GMT',
      'last-modified': 'Fri, 17 Jul 2026 18:38:36 GMT',
    },
  }

  it('is not read unless asked for', async () => {
    // strictEnv throws on an unstubbed request; stubbing headers but not asking
    // for them proves the request is never made.
    const result = await findDates(
      documentFrom('<article>Undated prose.</article>'),
      PAGE_URL,
      strictEnv({ text: {}, headers }),
      { now: NOW, sitemap: false },
    )

    expect(result.candidates).toEqual([])
  })

  it('is read when asked for, and ranks below everything else', async () => {
    const doc = documentFrom('<meta property="article:modified_time" content="2024-03-01">')

    const result = await findDates(doc, PAGE_URL, strictEnv({ text: {}, headers }), {
      now: NOW,
      httpHeaders: true,
    })

    expect(result.candidates.some((c) => c.source === 'http-last-modified')).toBe(true)
    // The site said 2024-03-01 out loud. The transport's guess does not get to
    // overrule it just for being more recent.
    expect(result.modified?.value).toBe('2024-03-01')
  })
})
