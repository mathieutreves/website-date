import { describe, expect, it } from 'vitest'
import type { Candidate, DateResult } from 'pagedate'
import { oldestCounterEvidence } from '../lib/evidence.js'

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  value: '2020-01-01',
  precision: 'day',
  field: 'unknown',
  source: 'itemprop',
  confidence: 'derived',
  ...over,
})

const predated = (candidates: Candidate[], published: Candidate): DateResult => ({
  published,
  candidates: [published, ...candidates],
  conflict: { kind: 'predated-content', gapDays: 4463, detail: 'x' },
})

describe('the date a contradicting page is talking over', () => {
  it('finds the oldest hard timestamp the page carries', () => {
    const found = oldestCounterEvidence(
      predated(
        [
          candidate({ value: '2018-11-20' }),
          candidate({ value: '2014-03-12' }),
          candidate({ value: '2021-02-09' }),
        ],
        candidate({ value: '2026-05-28', confidence: 'declared', field: 'published' }),
      ),
    )
    expect(found?.value).toBe('2014-03-12')
  })

  it('ignores dates lifted from prose', () => {
    // An article mentioning 2014 is not evidence of being written in 2014.
    // The library excludes inferred candidates when detecting the conflict;
    // excluding them here keeps the two in agreement.
    const found = oldestCounterEvidence(
      predated(
        [
          candidate({ value: '2001-09-11', confidence: 'inferred', source: 'visible-text' }),
          candidate({ value: '2014-03-12' }),
        ],
        candidate({ value: '2026-05-28', confidence: 'declared', field: 'published' }),
      ),
    )
    expect(found?.value).toBe('2014-03-12')
  })

  it('ignores a date that is barely older', () => {
    // Two dates a week apart are the same story told twice.
    const found = oldestCounterEvidence(
      predated(
        [candidate({ value: '2026-05-21' })],
        candidate({ value: '2026-05-28', confidence: 'declared', field: 'published' }),
      ),
    )
    expect(found).toBeNull()
  })

  it('never returns the declared date itself', () => {
    const published = candidate({ value: '2026-05-28', confidence: 'declared' })
    expect(oldestCounterEvidence(predated([], published))).toBeNull()
  })
})

describe('when there is nothing to counter with', () => {
  it('stays silent on a page with no conflict', () => {
    // The oldest candidate is always *something*; without a contradiction it
    // is just the bottom of a normal spread and means nothing.
    expect(
      oldestCounterEvidence({
        published: candidate({ value: '2026-05-28', confidence: 'declared' }),
        candidates: [candidate({ value: '2014-03-12' })],
      }),
    ).toBeNull()
  })

  it('stays silent on a stale declaration, where the evidence is newer', () => {
    // That conflict means the page changed *after* the date it shows. Its
    // evidence is an archive capture, not a candidate, and surfacing an older
    // date would point in exactly the wrong direction.
    expect(
      oldestCounterEvidence({
        published: candidate({ value: '2019-03-01', confidence: 'declared' }),
        candidates: [],
        conflict: { kind: 'stale-declaration', gapDays: 1400, detail: 'x' },
      }),
    ).toBeNull()
  })

  it('handles a page with no resolved date at all', () => {
    expect(
      oldestCounterEvidence({
        candidates: [candidate({ value: '2014-03-12' })],
        conflict: { kind: 'declared-disagreement', gapDays: 900, detail: 'x' },
      }),
    ).toBeNull()
  })
})
