import { describe, expect, it } from 'vitest'
import type { Candidate, DateResult } from 'pagedate'
import { display, escapeHtml, view } from '../entrypoints/popup/render.js'

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  value: '2023-04-11',
  precision: 'day',
  field: 'published',
  source: 'jsonld',
  confidence: 'declared',
  ...over,
})

const result = (over: Partial<DateResult> = {}): DateResult => ({ candidates: [], ...over })

describe('escaping', () => {
  it('neutralises markup in interpolated values', () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    )
  })

  it('escapes a hostile source or note reaching the DOM', () => {
    // Candidate fields derive from page content, so they are untrusted input.
    const html = view(
      result({
        published: candidate({ source: '<script>x</script>', note: `" onmouseover="y` }),
      }),
      'https://example.com/p',
      false,
    )

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('" onmouseover="y')
  })
})

describe('precision is never inflated in the UI', () => {
  it('renders a year candidate as just the year', () => {
    // "1 January 2024" would assert a day the page never stated.
    expect(display(candidate({ value: '2024', precision: 'year' }))).toBe('2024')
  })

  it('renders a month candidate without a day', () => {
    const shown = display(candidate({ value: '2024-03', precision: 'month' }))
    expect(shown).toMatch(/2024/)
    expect(shown).not.toMatch(/\b1\b/)
  })

  it('renders a day candidate in UTC so the date does not shift', () => {
    // Without timeZone: 'UTC' this renders as the 10th west of Greenwich.
    expect(display(candidate({ value: '2023-04-11', precision: 'day' }))).toMatch(/11/)
  })

  it('falls back to the raw value rather than showing Invalid Date', () => {
    expect(display(candidate({ value: 'nonsense', precision: 'day' }))).toBe('nonsense')
  })
})

describe('confidence tiers are visually distinct', () => {
  it('tags each tier with its own class', () => {
    for (const tier of ['declared', 'derived', 'inferred'] as const) {
      const html = view(
        result({ published: candidate({ confidence: tier }) }),
        'https://example.com/p',
        false,
      )
      expect(html).toContain(`tier-${tier}`)
    }
  })

  it('names the provenance in words as well', () => {
    const html = view(
      result({ published: candidate({ confidence: 'inferred', source: 'url-slug' }) }),
      'https://example.com/p',
      false,
    )
    expect(html).toContain('inferred')
    expect(html).toContain('url-slug')
  })
})

describe('conflict', () => {
  it('leads with the contradiction when the site disagrees with itself', () => {
    const html = view(
      result({
        published: candidate(),
        conflict: {
          kind: 'declared-disagreement',
          gapDays: 1700,
          detail: 'jsonld says 2019-03-01, opengraph says 2023-11-15.',
        },
      }),
      'https://example.com/p',
      false,
    )

    expect(html).toContain('contradicts itself')
    expect(html.indexOf('conflict')).toBeLessThan(html.indexOf('Published'))
  })

  it('says a page is older than claimed when its content predates the declared date', () => {
    const html = view(
      result({
        published: candidate({ value: '2026-05-28' }),
        conflict: {
          kind: 'predated-content',
          gapDays: 4463,
          detail: 'Declares 2026-05-28, but carries 8 dated elements from before then.',
        },
      }),
      'https://css-tricks.com/x/',
      false,
    )

    expect(html).toContain('older than it says')
    expect(html).toContain('8 dated elements')
  })

  it('uses distinct wording for each conflict kind', () => {
    const headings = (['declared-disagreement', 'predated-content', 'stale-declaration'] as const)
      .map(
        (kind) =>
          view(
            result({ conflict: { kind, gapDays: 900, detail: 'x' } }),
            'https://example.com/p',
            false,
          ).match(/<div class="conflict-heading">([^<]+)</)?.[1],
      )
      .filter(Boolean)

    // Three different problems must not read as the same warning.
    expect(new Set(headings).size).toBe(3)
  })
})

describe('empty and cached states', () => {
  it('says finding nothing can be the right answer', () => {
    const html = view(result(), 'https://danluu.com/x/', false)
    // A page with no date is a legitimate outcome, not a failure to report.
    expect(html).toContain('sometimes the correct answer')
  })

  it('offers a refresh only when showing a cached result', () => {
    expect(view(result(), 'https://example.com/p', true)).toContain('id="refresh"')
    expect(view(result(), 'https://example.com/p', false)).not.toContain('id="refresh"')
  })

  it('lists unresolved candidates separately from the chosen pair', () => {
    const chosen = candidate()
    const other = candidate({ value: '2019-01-01', source: 'url-slug', confidence: 'inferred' })
    const html = view(
      result({ published: chosen, candidates: [chosen, other] }),
      'https://example.com/p',
      false,
    )

    expect(html).toContain('1 other candidate')
    expect(html).not.toContain('1 other candidates')
  })
})
