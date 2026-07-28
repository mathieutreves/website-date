import { describe, expect, it } from 'vitest'
import { extractFromDocument, findDates } from '../src/index.js'
import { documentFrom, NOW, strictEnv } from './helpers.js'

const URL_ = 'https://example.com/posts/thing'

/** Metadata plus a labelled text date plus an unlabelled one. */
const RICH = `
  <html lang="en-GB"><head>
    <meta property="article:published_time" content="2023-04-11T09:00:00Z">
  </head><body>
    <article>
      <p class="meta">Last updated 2 September 2025</p>
      <p>11 April 2023</p>
    </article>
  </body></html>`

/** No metadata at all — only an unlabelled byline date. */
const BARE = `<html lang="en"><body><article><p>11 April 2023</p></article></body></html>`

const sources = (html: string, options = {}) =>
  extractFromDocument(documentFrom(html), URL_, options).map((c) => c.source)

describe('mode', () => {
  it('defaults to standard', () => {
    expect(sources(RICH)).toEqual(sources(RICH, { mode: 'standard' }))
  })

  it('fast reads declared metadata and skips all text scanning', () => {
    const found = sources(RICH, { mode: 'fast' })

    expect(found).toContain('opengraph')
    expect(found).not.toContain('visible-text')
    expect(found).not.toContain('text-date')
  })

  it('fast still answers a page that declares its date', () => {
    const found = extractFromDocument(documentFrom(RICH), URL_, { mode: 'fast' })
    expect(found.find((c) => c.field === 'published')?.value).toBe('2023-04-11T09:00Z')
  })

  it('standard reads labelled text but leaves unlabelled text alone', () => {
    const found = sources(RICH, { mode: 'standard' })

    expect(found).toContain('visible-text')
    // Something labelled was found, so the noisy fallback stays off.
    expect(found).not.toContain('text-date')
  })

  it('standard falls back to unlabelled text when nothing labelled exists', () => {
    expect(sources(BARE, { mode: 'standard' })).toContain('text-date')
  })

  it('extensive collects unlabelled text even when metadata answered', () => {
    const found = sources(RICH, { mode: 'extensive' })

    expect(found).toContain('opengraph')
    expect(found).toContain('text-date')
  })

  it('fast finds nothing on a page whose only date is in prose', () => {
    // The honest trade: five times faster, blind to undated-metadata pages.
    expect(extractFromDocument(documentFrom(BARE), URL_, { mode: 'fast' })).toEqual([])
  })
})

describe('dayFirst override', () => {
  it('beats the heuristic derived from lang and TLD', () => {
    const html = `<html lang="en"><body><article><p>Published 03/04/2024</p></article></body></html>`

    expect(
      extractFromDocument(documentFrom(html), 'https://example.com/x', { dayFirst: 'day-first' })
        .find((c) => c.source === 'visible-text')?.value,
    ).toBe('2024-04-03')

    expect(
      extractFromDocument(documentFrom(html), 'https://example.com/x', { dayFirst: 'month-first' })
        .find((c) => c.source === 'visible-text')?.value,
    ).toBe('2024-03-04')
  })
})

describe('minConfidence', () => {
  it('declared answers "what does the site actually claim"', () => {
    const found = extractFromDocument(documentFrom(RICH), URL_, { minConfidence: 'declared' })

    expect(found.length).toBeGreaterThan(0)
    expect(found.every((c) => c.confidence === 'declared')).toBe(true)
  })

  it('derived keeps markup-based signals but drops guesses', () => {
    const found = extractFromDocument(documentFrom(RICH), URL_, { minConfidence: 'derived' })
    expect(found.every((c) => c.confidence !== 'inferred')).toBe(true)
  })

  it('can legitimately return nothing rather than a guess', () => {
    // A page with only an inferred date has nothing to say at this threshold,
    // and saying nothing is the point of asking.
    expect(extractFromDocument(documentFrom(BARE), URL_, { minConfidence: 'declared' })).toEqual([])
  })
})

describe('options reach findDates', () => {
  it('threads mode through the full pipeline', async () => {
    const result = await findDates(documentFrom(BARE), URL_, strictEnv(), {
      mode: 'fast',
      now: NOW,
    })

    expect(result.candidates).toEqual([])
    expect(result.published).toBeUndefined()
  })

  it('still resolves normally at the default mode', async () => {
    const result = await findDates(documentFrom(RICH), URL_, strictEnv(), { now: NOW })

    expect(result.published?.value).toBe('2023-04-11T09:00Z')
    expect(result.modified?.value).toBe('2025-09-02')
  })
})
