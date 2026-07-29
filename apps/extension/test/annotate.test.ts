import { describe, expect, it } from 'vitest'
import type { Candidate, DateResult } from 'pagedate'
import {
  chipFor,
  MAX_FETCHES_PER_PAGE,
  pooled,
  shouldFetch,
  FETCH_CONCURRENCY,
} from '../lib/annotate.js'
import type { LinkDate } from '../lib/link-date.js'

const NOW = new Date('2026-07-28T12:00:00Z')

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  value: '2019-03-04',
  precision: 'day',
  field: 'published',
  source: 'jsonld',
  confidence: 'declared',
  ...over,
})

const link = (result: DateResult, tier: LinkDate['tier'] = 'fetch'): LinkDate => ({
  url: 'https://example.com/x',
  result,
  tier,
})

describe('chipFor', () => {
  it('reuses the badge’s compact vocabulary', () => {
    const chip = chipFor(link({ candidates: [], published: candidate() }), NOW)
    // Seven years back from NOW.
    expect(chip?.text).toBe('7y')
  })

  it('carries the exact date and provenance in the tooltip', () => {
    const chip = chipFor(link({ candidates: [], published: candidate() }), NOW)

    expect(chip?.title).toContain('Published')
    expect(chip?.title).toContain('2019')
    expect(chip?.title).toContain('JSON-LD')
  })

  it('takes its tone from the confidence tier', () => {
    expect(chipFor(link({ candidates: [], published: candidate() }), NOW)?.tone).toBe('declared')
    expect(
      chipFor(link({ candidates: [], published: candidate({ confidence: 'derived' }) }), NOW)?.tone,
    ).toBe('derived')
  })

  /*
   * A URL-tier chip is a guess about an address. Presenting it with the weight
   * of a declared JSON-LD date would overstate it, so the tier overrides
   * whatever the resolver concluded within the candidate set.
   */
  it('forces a URL-tier reading to inferred, whatever the resolver said', () => {
    const chip = chipFor(link({ candidates: [], published: candidate() }, 'url'), NOW)

    expect(chip?.tone).toBe('inferred')
    expect(chip?.title).toContain('link address')
  })

  it('shows a conflict rather than an age', () => {
    const chip = chipFor(
      link({
        candidates: [],
        published: candidate(),
        conflict: {
          kind: 'declared-disagreement',
          gapDays: 400,
          detail: 'x',
          earlier: { source: 'jsonld', value: '2019-03-04' },
          later: { source: 'opengraph', value: '2020-04-08' },
        },
      }),
      NOW,
    )

    expect(chip?.text).toBe('!')
    expect(chip?.tone).toBe('alert')
  })

  it('falls back to the modified date when there is no published one', () => {
    const chip = chipFor(
      link({ candidates: [], modified: candidate({ field: 'modified', value: '2026-07-01' }) }),
      NOW,
    )

    // 27.5 days, which the badge's compact form rounds.
    expect(chip?.text).toBe('28d')
    expect(chip?.title).toContain('Last modified')
  })

  it('returns null when there is nothing to show', () => {
    expect(chipFor(link({ candidates: [] }), NOW)).toBeNull()
  })
})

describe('shouldFetch', () => {
  const seen = new Set<string>()

  it('never fetches what the URL already answered', () => {
    const answered = link({ candidates: [], published: candidate() }, 'url')
    expect(shouldFetch('https://a.example/x', answered, 0, seen)).toBe(false)
  })

  it('stops at the per-page cap', () => {
    expect(shouldFetch('https://a.example/x', null, MAX_FETCHES_PER_PAGE - 1, seen)).toBe(true)
    expect(shouldFetch('https://a.example/x', null, MAX_FETCHES_PER_PAGE, seen)).toBe(false)
    expect(shouldFetch('https://a.example/x', null, MAX_FETCHES_PER_PAGE + 5, seen)).toBe(false)
  })

  it('does not fetch the same target twice', () => {
    expect(shouldFetch('https://a.example/x', null, 0, new Set(['https://a.example/x']))).toBe(false)
  })

  it('refuses a non-http scheme', () => {
    expect(shouldFetch('javascript:alert(1)', null, 0, seen)).toBe(false)
  })

  /*
   * The cap is what stops an infinite-scroll results page turning a setting into
   * an unbounded series of requests to third-party sites. It is not a tuning
   * knob and a regression on it would be silent, so it is asserted directly.
   */
  it('caps at one screen of results', () => {
    expect(MAX_FETCHES_PER_PAGE).toBe(10)
    expect(FETCH_CONCURRENCY).toBeLessThanOrEqual(3)
  })
})

describe('pooled', () => {
  it('runs every item', async () => {
    const done: number[] = []
    await pooled([1, 2, 3, 4, 5], 2, async (n) => {
      done.push(n)
    })
    expect(done.sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('never exceeds the concurrency limit', async () => {
    let live = 0
    let peak = 0

    await pooled(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      live++
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, 1))
      live--
    })

    expect(peak).toBeLessThanOrEqual(3)
  })

  it('keeps going when one task fails', async () => {
    const done: number[] = []
    await pooled([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom')
      done.push(n)
    })
    expect(done.sort()).toEqual([1, 3])
  })

  it('handles an empty list without hanging', async () => {
    await expect(pooled([], 3, async () => {})).resolves.toBeUndefined()
  })
})
