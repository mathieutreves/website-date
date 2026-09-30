import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyze, cacheKey, isSoftNavigated, sameDocument } from '../lib/analyze.js'
import { fakeBrowser } from './fake-browser.js'

/**
 * The guard behind the single-page-app fix.
 *
 * Reddit, GitHub and most of the modern web navigate with `history.pushState`:
 * the URL changes before the new view renders. A read fired on that event can
 * return the *previous* route's markup, which would then be cached under the
 * new URL and served as fact for a week. So a read has to prove it belongs to
 * the page it was asked about before anything trusts it.
 */
describe('proving a read belongs to the page it was asked about', () => {
  it('accepts the same document', () => {
    expect(sameDocument('https://x.com/a', 'https://x.com/a')).toBe(true)
  })

  it('accepts an in-page anchor, which is a position not a document', () => {
    expect(sameDocument('https://x.com/a#comments', 'https://x.com/a')).toBe(true)
  })

  it('refuses a different route, which is the SPA race', () => {
    // Reddit changes the URL before rendering the new post; without this the
    // previous post's DOM gets cached under the new URL for a week.
    expect(sameDocument('https://reddit.com/r/x/1', 'https://reddit.com/r/x/2')).toBe(false)
  })

  it('falls back to string equality on an unparseable URL', () => {
    expect(sameDocument('junk', 'junk')).toBe(true)
    expect(sameDocument('junk', 'other')).toBe(false)
  })
})

/*
 * The other half of the same race, which the guard above cannot see. On
 * `pushState` the URL changes *first*: `location.href` already matches while
 * the metadata in the head still describes the previous route. The read is
 * about the right address and the wrong page, and nothing in it says so —
 * except that the document is no longer at the address it was loaded from.
 */
describe('recognising a document that has changed route since it loaded', () => {
  const read = (loaded: string | undefined, href: string) => ({ candidates: [], href, loaded })

  it('is not soft when the document is where it was loaded', () => {
    expect(isSoftNavigated(read('https://x.com/a', 'https://x.com/a'))).toBe(false)
  })

  it('is not soft for an in-page anchor', () => {
    expect(isSoftNavigated(read('https://x.com/a', 'https://x.com/a#comments'))).toBe(false)
  })

  it('is soft once the route has changed without a load', () => {
    expect(isSoftNavigated(read('https://reddit.com/r/x/1', 'https://reddit.com/r/x/2'))).toBe(true)
  })

  it('makes no claim when the browser did not say where the document loaded', () => {
    expect(isSoftNavigated(read(undefined, 'https://x.com/a'))).toBe(false)
    expect(isSoftNavigated(undefined)).toBe(false)
  })
})

describe('what analyze writes to the cache', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** A browser whose tab answers the extractor with `pageRead`. */
  const browserWith = (pageRead: unknown) => {
    const fake = fakeBrowser({ granted: ['*://*/*'] })
    fake.api.scripting.executeScript.mockImplementation(async () => [{ result: pageRead }])
    vi.stubGlobal('browser', fake.api)
    return fake
  }

  const URL_B = 'https://reddit.com/r/x/2'
  const candidates = [
    { value: '2024-03-12', precision: 'day', field: 'published', confidence: 'declared', source: 'jsonld' },
  ]

  it('caches an ordinary read', async () => {
    const { stored } = browserWith({ candidates, href: URL_B, loaded: URL_B })

    const analysis = await analyze(1, URL_B, { expectUrl: URL_B })

    expect(analysis).toMatchObject({ fromCache: false })
    expect(stored).toHaveProperty([cacheKey(URL_B)])
  })

  it('shows a read from a soft-navigated document, and does not keep it', async () => {
    const { stored } = browserWith({ candidates, href: URL_B, loaded: 'https://reddit.com/r/x/1' })

    const analysis = await analyze(1, URL_B, { expectUrl: URL_B })

    expect('result' in analysis && analysis.result.published?.value).toBe('2024-03-12')
    expect(Object.keys(stored)).toEqual([])
  })

  /*
   * What the worker passes for a URL change with no load behind it, and for a
   * private window. Either way the answer is shown and nothing reaches disk.
   */
  it('does not keep a read the caller says not to', async () => {
    const { stored } = browserWith({ candidates, href: URL_B, loaded: URL_B })

    const analysis = await analyze(1, URL_B, { expectUrl: URL_B, persist: false })

    expect(analysis).toMatchObject({ fromCache: false })
    expect(Object.keys(stored)).toEqual([])
  })
})
