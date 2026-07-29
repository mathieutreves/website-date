import { DOMParser } from 'linkedom'
import { describe, expect, it } from 'vitest'
import type { Candidate } from 'pagedate'
import {
  dateFromCandidates,
  dateFromFetch,
  dateFromUrl,
  dateLink,
  originPattern,
} from '../lib/link-date.js'

const NOW = new Date('2026-07-28T12:00:00Z')

const parse = (html: string): Document =>
  new DOMParser().parseFromString(html, 'text/html') as unknown as Document

describe('dateFromUrl', () => {
  it('reads a dated permalink, and contacts nobody to do it', () => {
    const found = dateFromUrl('https://example.com/2019/03/04/some-post/', NOW)

    expect(found?.tier).toBe('url')
    expect(found?.result.published?.value).toBe('2019-03-04')
  })

  it('reads a named-month permalink', () => {
    expect(dateFromUrl('https://example.com/2019/mar/04/post/', NOW)?.result.published?.value).toBe(
      '2019-03-04',
    )
  })

  it('returns null for a path with no date, rather than an empty result', () => {
    expect(dateFromUrl('https://example.com/docs/getting-started', NOW)).toBeNull()
  })

  it('returns null for an unparseable URL', () => {
    expect(dateFromUrl('not a url', NOW)).toBeNull()
  })

  /*
   * The plausibility filter runs, so a path that merely contains four digits
   * does not become a date. This is what keeps the free tier from annotating
   * `/status/1234567890` with a year.
   */
  it('does not invent a date from an arbitrary number in the path', () => {
    expect(dateFromUrl('https://example.com/status/1234567890', NOW)).toBeNull()
  })
})

describe('dateFromFetch', () => {
  it('reads metadata from the fetched document', async () => {
    const doc = parse(`
      <html><head>
        <meta property="article:published_time" content="2023-04-11T09:00:00Z">
      </head><body></body></html>`)

    const found = await dateFromFetch('https://example.com/post', async () => doc, NOW)

    expect(found?.tier).toBe('fetch')
    expect(found?.result.published?.source).toBe('opengraph')
  })

  it('returns null when the page could not be fetched', async () => {
    expect(await dateFromFetch('https://example.com/post', async () => null, NOW)).toBeNull()
  })

  it('returns null when the fetcher throws, rather than propagating', async () => {
    const found = await dateFromFetch(
      'https://example.com/post',
      async () => {
        throw new Error('network')
      },
      NOW,
    )
    expect(found).toBeNull()
  })

  it('returns null for a page that carries no date at all', async () => {
    const doc = parse('<html><body><p>Nothing dated here.</p></body></html>')
    expect(await dateFromFetch('https://example.com/x', async () => doc, NOW)).toBeNull()
  })
})

describe('dateFromCandidates', () => {
  const candidate: Candidate = {
    value: '2024-03-12',
    precision: 'day',
    field: 'published',
    source: 'jsonld',
    confidence: 'declared',
  }

  it('ranks candidates extracted elsewhere', () => {
    const found = dateFromCandidates('https://example.com/x', [candidate], NOW)
    expect(found?.result.published?.value).toBe('2024-03-12')
    expect(found?.tier).toBe('fetch')
  })

  /*
   * The distinction the whole worker/tab split rests on: an empty list means the
   * page was read and says nothing, which is a different outcome from a page
   * that could not be read — and only the caller can tell them apart, because
   * this returns null for both.
   */
  it('returns null for an empty candidate list', () => {
    expect(dateFromCandidates('https://example.com/x', [], NOW)).toBeNull()
  })
})

describe('dateLink', () => {
  it('prefers the free tier and never fetches when the URL answers', async () => {
    let fetched = 0
    const found = await dateLink('https://example.com/2019/03/04/post/', {
      fetchDocument: async () => {
        fetched++
        return parse('<html></html>')
      },
      now: NOW,
    })

    expect(found?.tier).toBe('url')
    expect(fetched).toBe(0)
  })

  it('falls through to fetching when the URL says nothing', async () => {
    const doc = parse(
      '<html><head><meta property="article:published_time" content="2023-04-11T09:00:00Z"></head></html>',
    )

    const found = await dateLink('https://example.com/docs/thing', {
      fetchDocument: async () => doc,
      now: NOW,
    })

    expect(found?.tier).toBe('fetch')
  })

  it('makes no request at all when no fetcher is supplied', async () => {
    expect(await dateLink('https://example.com/docs/thing', { now: NOW })).toBeNull()
  })
})

describe('originPattern', () => {
  it('narrows to the one origin, not the whole web', () => {
    expect(originPattern('https://example.com/a/b?c=d')).toBe('https://example.com/*')
  })

  it('keeps the port, which is part of the origin', () => {
    expect(originPattern('http://example.com:8080/a')).toBe('http://example.com:8080/*')
  })

  it('refuses a non-web scheme', () => {
    expect(originPattern('file:///etc/passwd')).toBeNull()
    expect(originPattern('javascript:alert(1)')).toBeNull()
    expect(originPattern('nonsense')).toBeNull()
  })
})
