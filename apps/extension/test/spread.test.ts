import { describe, expect, it } from 'vitest'
import type { Candidate, DateResult } from 'pagedate'
import { computeSpread, isSpreadWorthShowing, spanLabel } from '../lib/spread.js'

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  value: '2023-04-11',
  precision: 'day',
  field: 'published',
  source: 'jsonld',
  confidence: 'declared',
  ...over,
})

const of = (values: string[], over: Partial<DateResult> = {}): DateResult => ({
  candidates: values.map((value) => candidate({ value })),
  ...over,
})

describe('geometry', () => {
  it('places the endpoints at 0 and 1 and everything else in proportion', () => {
    // The midpoint is exactly halfway in *time*, which is the whole reason this
    // is an axis and not a list: a list would space these three evenly.
    const spread = computeSpread(of(['2020-01-01', '2021-01-01', '2022-01-01']))
    expect(spread?.points.map((p) => Number(p.x.toFixed(2)))).toEqual([0, 0.5, 1])
  })

  it('puts a distant outlier near the edge rather than in an even row', () => {
    const spread = computeSpread(of(['2014-01-01', '2025-06-01', '2026-01-01']))
    const [oldest, middle] = spread!.points
    expect(oldest!.x).toBe(0)
    // Eleven years, then seven months. An evenly spaced list would show 0.5.
    expect(middle!.x).toBeGreaterThan(0.9)
  })

  it('returns nothing when there is no spread to draw', () => {
    expect(computeSpread(of(['2023-04-11']))).toBeNull()
    expect(computeSpread(of(['2023-04-11', '2023-04-11']))).toBeNull()
    expect(computeSpread(of([]))).toBeNull()
  })

  it('ignores candidates whose value is not a date', () => {
    const spread = computeSpread(of(['nonsense', '2020-01-01', '2022-01-01']))
    expect(spread?.points).toHaveLength(2)
  })
})

describe('collapsing', () => {
  it('collapses a day to one point but remembers how many landed there', () => {
    // Comment threads produce many timestamps on one day; drawing each buries
    // the declared date under a smear that says nothing the count does not.
    const spread = computeSpread(
      of(['2020-01-01', '2020-01-01', '2020-01-01', '2024-01-01']),
    )
    expect(spread?.points).toHaveLength(2)
    expect(spread?.points[0]?.count).toBe(3)
  })

  it('keeps the strongest claim when a day carries several', () => {
    const spread = computeSpread({
      candidates: [
        candidate({ value: '2020-01-01', confidence: 'inferred', source: 'url-slug' }),
        candidate({ value: '2020-01-01', confidence: 'declared', source: 'jsonld' }),
        candidate({ value: '2024-01-01' }),
      ],
    })
    expect(spread?.points[0]?.candidate.confidence).toBe('declared')
  })

  it('marks which points are the resolved pair so they can be emphasised', () => {
    const published = candidate({ value: '2020-01-01' })
    const modified = candidate({ value: '2024-01-01', field: 'modified' })
    const spread = computeSpread({
      published,
      modified,
      candidates: [published, modified, candidate({ value: '2022-01-01' })],
    })

    expect(spread?.points.map((p) => p.role)).toEqual(['published', 'other', 'modified'])
  })
})

describe('when it is worth showing', () => {
  it('needs three dates, or a contradiction', () => {
    const two = of(['2020-01-01', '2024-01-01'])
    expect(isSpreadWorthShowing(computeSpread(two), two)).toBe(false)

    const three = of(['2020-01-01', '2022-01-01', '2024-01-01'])
    expect(isSpreadWorthShowing(computeSpread(three), three)).toBe(true)

    // Two dates that contradict each other is exactly the case where the gap
    // is the finding.
    const conflicted = of(['2020-01-01', '2024-01-01'], {
      conflict: { kind: 'declared-disagreement', gapDays: 1461, detail: 'x' },
    })
    expect(isSpreadWorthShowing(computeSpread(conflicted), conflicted)).toBe(true)
  })
})

describe('span labels', () => {
  it('picks a unit a reader would use out loud', () => {
    expect(spanLabel(4000)).toMatch(/11/)
    expect(spanLabel(90)).toMatch(/3/)
    expect(spanLabel(9)).toMatch(/9/)
  })

  it('never reports a span of zero units', () => {
    expect(spanLabel(0.2)).toMatch(/1/)
  })
})
