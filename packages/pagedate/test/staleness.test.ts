import { describe, expect, it } from 'vitest'
import { isStale, staleness, toInterval } from '../src/staleness.js'
import type { Candidate, DateResult } from '../src/types.js'
import { NOW } from './helpers.js'

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  value: '2026-07-01',
  precision: 'day',
  field: 'published',
  source: 'jsonld',
  confidence: 'declared',
  ...over,
})

const result = (over: Partial<DateResult> = {}): DateResult => ({ candidates: [], ...over })

describe('toInterval', () => {
  it('widens a year to the whole year', () => {
    const span = toInterval(candidate({ value: '2024', precision: 'year' }))
    expect(span?.start.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(span?.end.toISOString()).toBe('2025-01-01T00:00:00.000Z')
  })

  it('widens a month to the whole month, across a year boundary', () => {
    const span = toInterval(candidate({ value: '2024-12', precision: 'month' }))
    expect(span?.end.toISOString()).toBe('2025-01-01T00:00:00.000Z')
  })

  it('widens a day to the whole day', () => {
    const span = toInterval(candidate({ value: '2024-02-29', precision: 'day' }))
    expect(span?.end.toISOString()).toBe('2024-03-01T00:00:00.000Z')
  })

  it('gives a minute one minute of width', () => {
    const span = toInterval(candidate({ value: '2024-03-12T09:30:00Z', precision: 'minute' }))
    expect(span!.end.getTime() - span!.start.getTime()).toBe(60_000)
  })

  it('returns null for a value that will not parse', () => {
    expect(toInterval(candidate({ value: 'not a date' }))).toBeNull()
  })
})

describe('staleness', () => {
  it('reports a recent page as fresh', () => {
    const verdict = staleness(result({ published: candidate({ value: '2026-07-01' }) }), {
      maxAgeDays: 180,
      now: NOW,
    })

    expect(verdict).toMatchObject({ stale: false, reason: 'fresh', basis: 'published' })
    expect(verdict.ageDays).toBe(26)
  })

  it('reports an old page as stale', () => {
    const verdict = staleness(result({ published: candidate({ value: '2019-03-04' }) }), {
      maxAgeDays: 180,
      now: NOW,
    })

    expect(verdict).toMatchObject({ stale: true, reason: 'stale' })
    expect(verdict.ageDays).toBeGreaterThan(2600)
  })

  it('prefers modified over published by default', () => {
    const verdict = staleness(
      result({
        published: candidate({ value: '2019-03-04' }),
        modified: candidate({ value: '2026-07-02', field: 'modified' }),
      }),
      { maxAgeDays: 180, now: NOW },
    )

    expect(verdict.basis).toBe('modified')
    expect(verdict.stale).toBe(false)
  })

  it('honours an explicit published basis, ignoring a fresh modified date', () => {
    const verdict = staleness(
      result({
        published: candidate({ value: '2019-03-04' }),
        modified: candidate({ value: '2026-07-02', field: 'modified' }),
      }),
      { maxAgeDays: 180, now: NOW, basis: 'published' },
    )

    expect(verdict.basis).toBe('published')
    expect(verdict.stale).toBe(true)
  })

  it('does not fall back to published when the basis is modified', () => {
    const verdict = staleness(result({ published: candidate() }), {
      maxAgeDays: 180,
      now: NOW,
      basis: 'modified',
    })

    expect(verdict).toMatchObject({ stale: null, reason: 'no-date', basis: null })
  })

  it('answers no-date when there is nothing to go on', () => {
    expect(staleness(result(), { maxAgeDays: 180, now: NOW })).toMatchObject({
      stale: null,
      reason: 'no-date',
      ageDays: null,
    })
  })

  describe('precision', () => {
    /*
     * NOW is 2026-07-28. Against a 180-day threshold the cutoff is 2026-01-29,
     * which falls inside the year 2026 — so a page that only said "2026" is
     * stale on one reading and fresh on another.
     */
    it('refuses to decide when the precision straddles the threshold', () => {
      const verdict = staleness(
        result({ published: candidate({ value: '2026', precision: 'year' }) }),
        { maxAgeDays: 180, now: NOW },
      )

      expect(verdict).toMatchObject({ stale: null, reason: 'imprecise' })
      // The interval runs to the end of 2026, which is still ahead of NOW, so
      // the youngest reading is a future one and the age at that end negative.
      expect(verdict.ageDays).toBe(-157)
      expect(verdict.maxAgeDays).toBe(208)
    })

    it('decides when the whole interval is on one side', () => {
      expect(
        staleness(result({ published: candidate({ value: '2024', precision: 'year' }) }), {
          maxAgeDays: 180,
          now: NOW,
        }),
      ).toMatchObject({ stale: true, reason: 'stale' })
    })

    it('a wide enough threshold makes an imprecise date decidable', () => {
      expect(
        staleness(result({ published: candidate({ value: '2026', precision: 'year' }) }), {
          maxAgeDays: 1000,
          now: NOW,
        }),
      ).toMatchObject({ stale: false, reason: 'fresh' })
    })
  })

  describe('minConfidence', () => {
    it('ignores a date below the floor', () => {
      const verdict = staleness(
        result({ published: candidate({ confidence: 'inferred', source: 'url-slug' }) }),
        { maxAgeDays: 180, now: NOW, minConfidence: 'declared' },
      )

      expect(verdict.reason).toBe('no-date')
    })

    it('falls back past a weak modified date to a strong published one', () => {
      const verdict = staleness(
        result({
          published: candidate({ value: '2019-03-04' }),
          modified: candidate({ value: '2026-07-02', field: 'modified', confidence: 'inferred' }),
        }),
        { maxAgeDays: 180, now: NOW, minConfidence: 'declared' },
      )

      expect(verdict.basis).toBe('published')
      expect(verdict.stale).toBe(true)
    })
  })

  it('treats a future date as fresh rather than as an error', () => {
    const verdict = staleness(result({ published: candidate({ value: '2027-01-01' }) }), {
      maxAgeDays: 180,
      now: NOW,
    })

    expect(verdict.stale).toBe(false)
    expect(verdict.ageDays).toBeLessThan(0)
  })
})

describe('isStale', () => {
  it('reduces a verdict to a boolean', () => {
    expect(isStale(result({ published: candidate({ value: '2019-03-04' }) }), {
      maxAgeDays: 180,
      now: NOW,
    })).toBe(true)

    expect(isStale(result({ published: candidate({ value: '2026-07-01' }) }), {
      maxAgeDays: 180,
      now: NOW,
    })).toBe(false)
  })

  it('counts an undecidable page as stale by default', () => {
    expect(isStale(result(), { maxAgeDays: 180, now: NOW })).toBe(true)
  })

  it('whenUnknown flips that, and only that', () => {
    expect(isStale(result(), { maxAgeDays: 180, now: NOW, whenUnknown: false })).toBe(false)

    // A page with a real, decidable date is unaffected by the option.
    expect(
      isStale(result({ published: candidate({ value: '2019-03-04' }) }), {
        maxAgeDays: 180,
        now: NOW,
        whenUnknown: false,
      }),
    ).toBe(true)
  })
})
