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

    // The same facts as data, so a UI can say this in its own language instead
    // of parsing them back out of the English above. Oldest first, whatever
    // order they were found in.
    if (result.conflict?.kind !== 'declared-disagreement') throw new Error('narrowing')
    expect(result.conflict.earlier).toEqual({ source: 'jsonld', value: '2019-03-01' })
    expect(result.conflict.later).toEqual({ source: 'opengraph', value: '2023-11-15' })
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

  describe('content older than the declared date', () => {
    const withComments = (years: string[]) => [
      candidate({ value: '2026-05-28', source: 'jsonld', confidence: 'declared' }),
      ...years.map((v) =>
        candidate({ value: v, source: 'time-tag', confidence: 'derived', field: 'unknown' }),
      ),
    ]

    it('flags a page carrying timestamps from before it claims to exist', () => {
      // Nobody can comment on an article before it is published, so the
      // declared date must be a republication stamp.
      const result = resolveCandidates(
        withComments(['2014-03-10', '2015-06-19', '2016-01-15', '2020-03-18']),
        { now: NOW },
      )

      expect(result.conflict?.kind).toBe('predated-content')
      expect(result.conflict?.detail).toContain('2014-03-10')

      if (result.conflict?.kind !== 'predated-content') throw new Error('narrowing')
      expect(result.conflict.declared).toBe('2026-05-28')
      expect(result.conflict.oldest).toBe('2014-03-10')
      // Distinct *days*, which is what the threshold counts — not candidates.
      expect(result.conflict.olderCount).toBe(4)
    })

    it('ignores a stray old date — an article may simply discuss the past', () => {
      const result = resolveCandidates(withComments(['2014-03-10']), { now: NOW })
      expect(result.conflict).toBeUndefined()
    })

    it('does not count prose dates, which are usually mentions of past events', () => {
      const result = resolveCandidates(
        [
          candidate({ value: '2026-05-28', source: 'jsonld', confidence: 'declared' }),
          ...['2014-03-10', '2015-06-19', '2016-01-15'].map((v) =>
            candidate({ value: v, source: 'visible-text', confidence: 'inferred' }),
          ),
        ],
        { now: NOW },
      )

      expect(result.conflict).toBeUndefined()
    })

    it('does not fire when the resolved date is already the oldest', () => {
      // The Stack Overflow shape: a 2012 question with answers edited later.
      const result = resolveCandidates(
        [
          candidate({ value: '2012-06-27', source: 'jsonld', confidence: 'declared' }),
          ...['2018-05-11', '2020-10-05', '2021-03-31'].map((v) =>
            candidate({ value: v, source: 'time-tag', confidence: 'derived', field: 'unknown' }),
          ),
        ],
        { now: NOW },
      )

      expect(result.conflict).toBeUndefined()
    })

    it('requires the declared date to be declared, not guessed', () => {
      const result = resolveCandidates(
        [
          candidate({ value: '2026-05-28', source: 'url-slug', confidence: 'inferred' }),
          ...['2014-03-10', '2015-06-19', '2016-01-15'].map((v) =>
            candidate({ value: v, source: 'time-tag', confidence: 'derived', field: 'unknown' }),
          ),
        ],
        { now: NOW },
      )

      expect(result.conflict).toBeUndefined()
    })
  })

  it('flags a stale declaration when the archive shows an edit the page hides', () => {
    const result = resolveCandidates([candidate({ value: '2019-03-01', field: 'published' })], {
      now: NOW,
      archiveLastEdit: '2024-06-01',
    })

    expect(result.conflict?.kind).toBe('stale-declaration')
    expect(result.conflict?.gapDays).toBeGreaterThan(365)

    if (result.conflict?.kind !== 'stale-declaration') throw new Error('narrowing')
    expect(result.conflict.declared).toBe('2019-03-01')
    // Truncated to the day: the archive's capture instant is more precision
    // than the claim "it changed on this date" can carry.
    expect(result.conflict.archived).toBe('2024-06-01')
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

/**
 * A publication date is a civil date somewhere, and UTC is not automatically
 * that somewhere. See `localise` in resolve.ts.
 */
describe('reporting the day the site published on', () => {
  it('renders a UTC declaration in the zone a naive sibling timestamp reveals', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2025-12-05T05:50Z', precision: 'minute', source: 'jsonld' }),
        // The same instant as the site itself wrote it: 23:50 the previous day.
        candidate({
          value: '2025-12-04T23:50',
          precision: 'minute',
          source: 'time-tag',
          confidence: 'derived',
          field: 'unknown',
        }),
      ],
      { now: NOW },
    )

    expect(result.published?.value).toBe('2025-12-04T23:50-06:00')
    // Still the JSON-LD's claim — only the rendering moved.
    expect(result.published?.source).toBe('jsonld')
    expect(result.published?.precision).toBe('minute')
  })

  it("takes the day from a date the markup labels as the page's own publication", () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2023-01-22T23:20Z', precision: 'minute', source: 'jsonld' }),
        candidate({ value: '2023-01-23', source: 'marked-date', confidence: 'derived' }),
      ],
      { now: NOW },
    )

    expect(result.published?.value).toBe('2023-01-23')
    // No offset was recoverable, so precision drops rather than being invented.
    expect(result.published?.precision).toBe('day')
  })

  it('ignores an unlabelled neighbouring day, which every sidebar is full of', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2023-01-22T23:20Z', precision: 'minute', source: 'jsonld' }),
        candidate({ value: '2023-01-23', source: 'marked-date', confidence: 'derived', field: 'unknown' }),
      ],
      { now: NOW },
    )

    expect(result.published?.value).toBe('2023-01-22T23:20Z')
  })

  it('leaves a declaration alone when the gap is bigger than a timezone', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2023-01-22T23:20Z', precision: 'minute', source: 'jsonld' }),
        // Two days out. Offsets span 26 hours, so a *one*-day disagreement is
        // always explicable by some zone and only the ±1 window is checked;
        // beyond it the page and its metadata genuinely disagree, and this
        // declines to paper over that.
        candidate({ value: '2023-01-24', source: 'marked-date', confidence: 'derived' }),
      ],
      { now: NOW },
    )

    expect(result.published?.value).toBe('2023-01-22T23:20Z')
  })

  it('rejects an implied offset no timezone uses', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2021-02-01T02:30Z', precision: 'minute', source: 'jsonld' }),
        // 14 hours behind UTC. The range runs to −12, so this is not a zone —
        // it is an unrelated timestamp that happens to share a minute hand.
        candidate({
          value: '2021-01-31T12:30',
          precision: 'minute',
          source: 'time-tag',
          confidence: 'derived',
          field: 'unknown',
        }),
      ],
      { now: NOW },
    )

    expect(result.published?.value).toBe('2021-02-01T02:30Z')
  })

  it('leaves a declaration that already carries a real offset alone', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2023-06-29T18:37+02:00', precision: 'minute', source: 'opengraph' }),
        candidate({ value: '2023-06-30', source: 'marked-date', confidence: 'derived' }),
      ],
      { now: NOW },
    )

    expect(result.published?.value).toBe('2023-06-29T18:37+02:00')
  })
})

describe('an unlabelled date against a labelled one', () => {
  it('does not let a higher-ranked source overturn a field label at the same tier', () => {
    // Horizont.net: the article's own marked publication date, against a <time>
    // from a related-articles rail. Both derived; `time-tag` merely sorts above
    // `marked-date` and carries a minute.
    const result = resolveCandidates(
      [
        candidate({
          value: '2019-01-29',
          source: 'marked-date',
          confidence: 'derived',
          field: 'published',
        }),
        candidate({
          value: '2018-03-12T19:30+00:00',
          precision: 'minute',
          source: 'time-tag',
          confidence: 'derived',
          field: 'unknown',
        }),
      ],
      { now: NOW },
    )

    expect(result.published?.value).toBe('2019-01-29')
    expect(result.published?.source).toBe('marked-date')
  })

  it('still promotes an unlabelled date that is genuinely better evidence', () => {
    // The case the promotion rule exists for: a marked date block should beat a
    // month guessed from the URL, and there the tiers really do differ.
    const result = resolveCandidates(
      [
        candidate({
          value: '2019-01',
          precision: 'month',
          source: 'url-slug',
          confidence: 'inferred',
          field: 'published',
        }),
        candidate({
          value: '2019-01-29',
          source: 'marked-date',
          confidence: 'derived',
          field: 'unknown',
        }),
      ],
      { now: NOW },
    )

    expect(result.published?.value).toBe('2019-01-29')
    expect(result.published?.note).toContain('unlabelled')
  })
})
