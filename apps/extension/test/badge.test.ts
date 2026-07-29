import { describe, expect, it } from 'vitest'
import type { Candidate, DateResult } from 'pagedate'
import { badgeFor, compactAge } from '../lib/badge.js'
import { t } from '../lib/messages.js'

const NOW = new Date('2026-07-28T12:00:00Z')

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  value: '2023-04-11',
  precision: 'day',
  field: 'published',
  source: 'jsonld',
  confidence: 'declared',
  ...over,
})

describe('compact age fits four characters', () => {
  it('steps through days, months and years', () => {
    expect(compactAge('2026-07-20', NOW)).toBe('9d')
    expect(compactAge('2026-01-28', NOW)).toBe('6mo')
    expect(compactAge('2023-04-11', NOW)).toBe('3y')
  })

  it('never renders a zero or negative age', () => {
    expect(compactAge('2026-07-28', NOW)).toBe('1d')
    expect(compactAge('2030-01-01', NOW)).toBe('→')
  })

  it('gives up rather than guessing on an unparseable value', () => {
    expect(compactAge('nonsense', NOW)).toBeNull()
  })
})

describe('what the icon says', () => {
  const result = (over: Partial<DateResult> = {}): DateResult => ({ candidates: [], ...over })

  it('reports the age and colours it by confidence', () => {
    const badge = badgeFor(result({ published: candidate() }), NOW)
    expect(badge.text).toBe('3y')
    expect(badge.color).toBe('#0f766e')
  })

  it('lets a contradiction outrank the age', () => {
    // Showing "2mo" on a page carrying a decade of older content would be the
    // badge repeating the page's own claim as though it were verified.
    const badge = badgeFor(
      result({
        published: candidate({ value: '2026-05-28' }),
        conflict: { kind: 'predated-content', gapDays: 4463, detail: 'carries older content' },
      }),
      NOW,
    )
    expect(badge.text).toBe('!')
    // The translated heading rather than `conflict.detail`. The detail is the
    // library's and is English in every locale; a tooltip is one string with
    // nothing beside it, so it cannot afford to be the untranslatable half.
    expect(badge.title).toBe(t('conflictPredated'))
  })

  it('says it does not know rather than showing nothing', () => {
    expect(badgeFor(result(), NOW).text).toBe('?')
    expect(badgeFor(null, NOW).text).toBe('?')
  })

  it('falls back to the modification date when that is all there is', () => {
    const badge = badgeFor(
      result({ modified: candidate({ value: '2026-01-28', field: 'modified' }) }),
      NOW,
    )
    expect(badge.text).toBe('6mo')
  })
})
