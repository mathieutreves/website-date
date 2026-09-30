import { DOMParser } from 'linkedom'
import { describe, expect, it } from 'vitest'
import type { Candidate } from 'pagedate'
import {
  dateFromCandidates,
  dateFromFetch,
  dateFromUrl,
  dateLink,
  fetchPageText,
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

/*
 * The request half of the fetch tier, which runs in the background worker. A
 * tab's own `fetch` answers to the page's CORS policy whatever the extension
 * has been granted, so it is the worker that asks and the tab that parses.
 */
describe('fetchPageText', () => {
  const html = '<html><head><title>x</title></head></html>'

  const respond =
    (body: BodyInit, init: ResponseInit & { url?: string } = {}) =>
    async (): Promise<Response> => {
      const response = new Response(body, { headers: { 'content-type': 'text/html' }, ...init })
      if (init.url) Object.defineProperty(response, 'url', { value: init.url })
      return response
    }

  it('returns the markup as text', async () => {
    expect(await fetchPageText('https://example.com/post', { fetchImpl: respond(html) })).toBe(html)
  })

  it('sends no cookies', async () => {
    let seen: RequestInit | undefined
    await fetchPageText('https://example.com/post', {
      fetchImpl: async (_url, init) => {
        seen = init
        return new Response(html, { headers: { 'content-type': 'text/html' } })
      },
    })
    expect(seen?.credentials).toBe('omit')
  })

  it('makes no request for a scheme that is not the web', async () => {
    let called = 0
    const fetchImpl = async () => (called++, new Response(html))
    expect(await fetchPageText('file:///etc/passwd', { fetchImpl })).toBeNull()
    expect(called).toBe(0)
  })

  it('makes no request to the private network when told the URL is a page\u2019s choice', async () => {
    let called = 0
    const fetchImpl = async () => (called++, new Response(html))
    expect(await fetchPageText('http://192.168.0.1/', { fetchImpl, publicOnly: true })).toBeNull()
    expect(called).toBe(0)
  })

  it('withholds a body that a redirect fetched from the private network', async () => {
    const fetchImpl = respond(html, { url: 'http://127.0.0.1/admin' })
    expect(await fetchPageText('https://example.com/r', { fetchImpl, publicOnly: true })).toBeNull()
  })

  it('refuses what is not a page', async () => {
    const pdf = respond('%PDF', { headers: { 'content-type': 'application/pdf' } })
    expect(await fetchPageText('https://example.com/a.pdf', { fetchImpl: pdf })).toBeNull()

    const missing = respond('nope', { status: 404 })
    expect(await fetchPageText('https://example.com/gone', { fetchImpl: missing })).toBeNull()
  })

  it('stops reading at the cap', async () => {
    const big = respond('a'.repeat(5000))
    const text = await fetchPageText('https://example.com/big', { fetchImpl: big, maxBytes: 1000 })
    expect(text).toHaveLength(1000)
  })

  it('returns null rather than throwing when the network fails or times out', async () => {
    const failing = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch')
    }
    expect(await fetchPageText('https://example.com/', { fetchImpl: failing })).toBeNull()

    const hanging = (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    expect(await fetchPageText('https://example.com/', { fetchImpl: hanging, timeoutMs: 10 })).toBeNull()
  })
})
