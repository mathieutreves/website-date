import { describe, expect, it } from 'vitest'
import type { Candidate } from '../src/types.js'
import { resolveCandidates } from '../src/resolve.js'
import { findDates } from '../src/index.js'
import { documentFrom, NOW, strictEnv } from './helpers.js'

const candidate = (over: Partial<Candidate>): Candidate => ({
  value: '2024-01-01',
  precision: 'day',
  field: 'published',
  source: 'jsonld',
  confidence: 'declared',
  ...over,
})

describe('ranking', () => {
  it('prefers declared over inferred regardless of precision', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2020-05-05', source: 'url-slug', confidence: 'inferred' }),
        candidate({ value: '2023-04-11', source: 'jsonld', confidence: 'declared' }),
      ],
      { now: NOW },
    )

    expect(result.published?.value).toBe('2023-04-11')
    expect(result.published?.confidence).toBe('declared')
  })

  it('breaks ties between equal-confidence sources by source priority', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2021-01-01', source: 'opengraph' }),
        candidate({ value: '2022-02-02', source: 'jsonld' }),
      ],
      { now: NOW },
    )

    expect(result.published?.source).toBe('jsonld')
  })

  it('keeps published and modified separate', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2019-03-01', field: 'published' }),
        candidate({ value: '2025-11-20', field: 'modified' }),
      ],
      { now: NOW },
    )

    expect(result.published?.value).toBe('2019-03-01')
    expect(result.modified?.value).toBe('2025-11-20')
  })
})

describe('plausibility filtering', () => {
  it('drops future dates and pre-1995 dates', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2088-01-01' }),
        candidate({ value: '1970-01-01' }),
        candidate({ value: '2023-04-11' }),
      ],
      { now: NOW },
    )

    expect(result.candidates).toHaveLength(1)
    expect(result.published?.value).toBe('2023-04-11')
  })

  it('drops a minute-precision timestamp that is effectively now', () => {
    const result = resolveCandidates(
      [candidate({ value: '2026-07-28T12:00Z', precision: 'minute' })],
      { now: NOW },
    )

    // A render timestamp, not a publication date.
    expect(result.candidates).toHaveLength(0)
  })

  it('keeps a day-precision date of today — that is just something published today', () => {
    const result = resolveCandidates([candidate({ value: '2026-07-28', precision: 'day' })], {
      now: NOW,
    })

    expect(result.published?.value).toBe('2026-07-28')
  })
})

describe('unlabelled candidates', () => {
  it('reads an unlabelled date as published when nothing else claims that field', () => {
    const result = resolveCandidates(
      [candidate({ value: '2022-08-08', field: 'unknown', source: 'meta-date' })],
      { now: NOW },
    )

    expect(result.published?.value).toBe('2022-08-08')
    expect(result.published?.note).toContain('unlabelled')
  })

  it('does not promote an unlabelled date that postdates the modification', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2026-01-01', field: 'unknown', source: 'meta-date' }),
        candidate({ value: '2024-01-01', field: 'modified' }),
      ],
      { now: NOW },
    )

    expect(result.published).toBeUndefined()
  })
})

describe('conflict detection', () => {
  it('flags a site contradicting itself on the same field', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2019-03-01', source: 'jsonld', confidence: 'declared' }),
        candidate({ value: '2023-11-15', source: 'opengraph', confidence: 'declared' }),
      ],
      { now: NOW },
    )

    expect(result.conflict?.kind).toBe('declared-disagreement')
    expect(result.conflict?.detail).toContain('2019-03-01')
    expect(result.conflict?.detail).toContain('2023-11-15')
  })

  it('does NOT flag published and modified merely differing', () => {
    // This is the ordinary case. Flagging it would leave the indicator
    // permanently lit and therefore ignorable.
    const result = resolveCandidates(
      [
        candidate({ value: '2019-03-01', field: 'published' }),
        candidate({ value: '2025-11-20', field: 'modified' }),
      ],
      { now: NOW },
    )

    expect(result.conflict).toBeUndefined()
  })

  it('does not flag declared values that agree closely', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2023-04-11', source: 'jsonld' }),
        candidate({ value: '2023-04-12', source: 'opengraph' }),
      ],
      { now: NOW },
    )

    expect(result.conflict).toBeUndefined()
  })

  it('flags a stale declaration when the archive shows an edit the page hides', () => {
    const result = resolveCandidates([candidate({ value: '2019-03-01', field: 'published' })], {
      now: NOW,
      archiveLastEdit: '2024-06-01',
    })

    expect(result.conflict?.kind).toBe('stale-declaration')
    expect(result.conflict?.gapDays).toBeGreaterThan(365)
  })

  it('does not flag a stale declaration when the page shows its own modified date', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2019-03-01', field: 'published' }),
        candidate({ value: '2024-06-01', field: 'modified' }),
      ],
      { now: NOW, archiveLastEdit: '2024-06-01' },
    )

    expect(result.conflict).toBeUndefined()
  })
})

describe('findDates end to end', () => {
  it('resolves a realistic article without touching the network', async () => {
    const doc = documentFrom(`
      <html lang="en-GB"><head>
        <script type="application/ld+json">
        {"@type":"BlogPosting","datePublished":"2023-04-11T09:00:00Z","dateModified":"2025-02-18T14:20:00Z"}
        </script>
        <meta property="article:published_time" content="2023-04-11T09:00:00Z">
      </head><body>
        <article>
          <header class="post-meta">
            <time datetime="2023-04-11">11 April 2023</time>
          </header>
          <p>Body text.</p>
        </article>
        <aside class="recent-posts"><time datetime="2026-07-01">1 July 2026</time></aside>
      </body></html>`)

    // strictEnv throws on any unstubbed fetch, so this passing proves the
    // extraction path is network-pure.
    const result = await findDates(doc, 'https://example.com/blog/post', strictEnv(), { now: NOW })

    expect(result.published?.value).toBe('2023-04-11T09:00Z')
    expect(result.published?.confidence).toBe('declared')
    expect(result.modified?.value).toBe('2025-02-18T14:20Z')
    expect(result.conflict).toBeUndefined()
    expect(result.candidates.some((c) => c.value.startsWith('2026-07-01'))).toBe(false)
  })
})
