import { describe, expect, it } from 'vitest'
import type { Candidate, DateResult } from 'pagedate'
import {
  display,
  escapeHtml,
  relativeAge,
  sourceLabel,
  view,
  type ViewOptions,
} from '../entrypoints/popup/render.js'

const NOW = new Date('2026-07-28T12:00:00Z')

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  value: '2023-04-11',
  precision: 'day',
  field: 'published',
  source: 'jsonld',
  confidence: 'declared',
  ...over,
})

const result = (over: Partial<DateResult> = {}): DateResult => ({ candidates: [], ...over })

const show = (r: DateResult, options: ViewOptions = {}): string =>
  view(r, 'https://example.com/p', { now: NOW, ...options })

describe('escaping', () => {
  it('neutralises markup in interpolated values', () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    )
  })

  it('escapes a hostile source or note reaching the DOM', () => {
    // Candidate fields derive from page content, so they are untrusted input.
    const html = show(
      result({ published: candidate({ source: '<script>x</script>', note: `" onmouseover="y` }) }),
    )

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('" onmouseover="y')
  })

  it('escapes a hostile value reaching the spread axis title', () => {
    const hostile = candidate({ value: '2019-01-01', source: '"><img src=x onerror=alert(1)>' })
    const html = show(
      result({
        published: candidate({ value: '2024-01-01' }),
        candidates: [hostile, candidate({ value: '2021-06-01' }), candidate({ value: '2024-01-01' })],
      }),
    )

    expect(html).toContain('class="spread"')
    expect(html).not.toContain('onerror=alert(1)>')
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

  it('keeps the clock time a minute-precision source carried', () => {
    // The rule cuts both ways: flattening this to a bare day discards precision
    // the source actually had.
    expect(display(candidate({ value: '2023-04-11T14:30:00Z', precision: 'minute' }))).toMatch(
      /\d{1,2}[:.]\d{2}/,
    )
  })

  it('falls back to the raw value rather than showing Invalid Date', () => {
    expect(display(candidate({ value: 'nonsense', precision: 'day' }))).toBe('nonsense')
  })
})

describe('confidence tiers are visually distinct', () => {
  it('tags each tier with its own class', () => {
    for (const tier of ['declared', 'derived', 'inferred'] as const) {
      expect(show(result({ published: candidate({ confidence: tier }) }))).toContain(`tier-${tier}`)
    }
  })

  it('names the provenance in words as well', () => {
    const html = show(
      result({ published: candidate({ confidence: 'inferred', source: 'url-slug' }) }),
    )
    expect(html).toContain('inferred')
    expect(html).toContain('url-slug')
  })
})

describe('age is the headline', () => {
  it('leads with how old the page is, not the calendar date', () => {
    const html = show(result({ published: candidate({ value: '2023-04-11' }) }))
    // The question being asked is "is this current?", so the answer to that
    // must appear before the evidence for it.
    expect(html.indexOf('years ago')).toBeLessThan(html.indexOf('2023'))
  })

  it('swaps the two when the reader asked for the date to lead', () => {
    const html = show(result({ published: candidate({ value: '2023-04-11' }) }), {
      dateFormat: 'absolute',
    })
    expect(html.indexOf('2023')).toBeLessThan(html.indexOf('years ago'))
  })

  it('writes dates as ISO 8601 when asked, throughout the panel', () => {
    const html = show(
      result({
        published: candidate({ value: '2023-04-11' }),
        modified: candidate({ value: '2025-02-18', field: 'modified' }),
      }),
      { dateFormat: 'iso' },
    )

    expect(html).toContain('2023-04-11')
    expect(html).toContain('2025-02-18')
    // Not "11 April 2023" anywhere: a reader who asked for one format and got
    // two has to work out which line is which.
    expect(html).not.toMatch(/April|Feb/)
    // ISO is an absolute format, so the date leads, as with `absolute`.
    expect(html.indexOf('2023-04-11')).toBeLessThan(html.indexOf('years ago'))
  })

  it('keeps ISO output at the precision the source carried', () => {
    expect(display(candidate({ value: '2024', precision: 'year' }), 'iso')).toBe('2024')
    expect(display(candidate({ value: '2024-03', precision: 'month' }), 'iso')).toBe('2024-03')
    expect(display(candidate({ value: '2024-03-12T09:30Z', precision: 'minute' }), 'iso')).toBe(
      '2024-03-12T09:30Z',
    )
  })

  it('hedges the age when the source was too vague to support an exact one', () => {
    // "2024" cannot justify "2 years ago" to the day — it could be either.
    expect(relativeAge(candidate({ value: '2024', precision: 'year' }), NOW)).toMatch(/^about /)
    expect(relativeAge(candidate({ value: '2023-04-11', precision: 'day' }), NOW)).not.toMatch(
      /^about /,
    )
  })

  it('does not claim an age it cannot compute', () => {
    expect(relativeAge(candidate({ value: 'nonsense' }), NOW)).toBeNull()
  })

  it('says so rather than reporting a negative age', () => {
    expect(relativeAge(candidate({ value: '2030-01-01' }), NOW)).toBe('dated in the future')
  })

  it('promotes the modification date when no publication date exists', () => {
    const html = show(result({ modified: candidate({ field: 'modified' }) }))
    // Still reported, but never silently relabelled as a publication date.
    expect(html).toContain('Last modified')
    expect(html).toMatch(/Published[\s\S]{0,200}not declared/)
  })
})

describe('provenance is stated in English', () => {
  it('translates extractor ids a reader has no reason to know', () => {
    expect(sourceLabel('atom-feed')).toBe('the site’s Atom feed')
    expect(sourceLabel('url-slug')).toBe('the page URL')
  })

  it('keeps the raw id in the DOM for debugging', () => {
    const html = show(result({ published: candidate({ source: 'atom-feed' }) }))
    expect(html).toContain('data-source="atom-feed"')
    expect(html).toContain('Atom feed')
  })

  it('degrades to the raw id for a source it has no label for', () => {
    expect(sourceLabel('some-new-extractor')).toBe('some new extractor')
  })
})

describe('conflict', () => {
  it('leads with the contradiction when the site disagrees with itself', () => {
    const html = show(
      result({
        published: candidate(),
        conflict: {
          kind: 'declared-disagreement',
          gapDays: 1700,
          detail: 'jsonld says 2019-03-01, opengraph says 2023-11-15.',
        },
      }),
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
      { now: NOW },
    )

    expect(html).toContain('older than it says')
    expect(html).toContain('8 dated elements')
  })

  it('uses distinct wording for each conflict kind', () => {
    const headings = (['declared-disagreement', 'predated-content', 'stale-declaration'] as const)
      .map(
        (kind) =>
          show(result({ conflict: { kind, gapDays: 900, detail: 'x' } })).match(
            /<p class="conflict-heading">([^<]+)</,
          )?.[1],
      )
      .filter(Boolean)

    // Three different problems must not read as the same warning.
    expect(new Set(headings).size).toBe(3)
  })

  it('reserves the alert treatment for conflicts that undermine the date shown', () => {
    const at = (kind: 'declared-disagreement' | 'predated-content' | 'stale-declaration') =>
      show(result({ published: candidate(), conflict: { kind, gapDays: 900, detail: 'x' } }))

    // The first two mean the headline date is wrong; the third means it is
    // right but incomplete. A flag that is always lit is furniture.
    expect(at('declared-disagreement')).toContain('conflict alert')
    expect(at('predated-content')).toContain('conflict alert')
    expect(at('stale-declaration')).toContain('conflict notice')
  })

  it('strips the headline of authority when the conflict undercuts it', () => {
    const disputed = show(
      result({
        published: candidate(),
        conflict: { kind: 'predated-content', gapDays: 900, detail: 'x' },
      }),
    )

    // Shown, not hidden — suppressing it would lose information — but it must
    // not read as confident directly under a warning that it is wrong.
    expect(disputed).toContain('disputed')
    expect(disputed).toContain('2023')
    expect(show(result({ published: candidate() }))).not.toContain('disputed')
  })
})

describe('the spread axis earns its space', () => {
  const spread = (values: string[]) =>
    result({
      published: candidate({ value: values[0]! }),
      candidates: values.map((value) => candidate({ value })),
    })

  it('is absent on a page with one clean date', () => {
    // A chart of a single fact is decoration.
    expect(show(result({ published: candidate() }))).not.toContain('class="spread"')
  })

  it('is absent when every candidate landed on the same day', () => {
    expect(show(spread(['2023-04-11', '2023-04-11', '2023-04-11']))).not.toContain('class="spread"')
  })

  it('appears once three distinct dates disagree', () => {
    const html = show(spread(['2019-01-01', '2021-06-01', '2024-03-01']))
    expect(html).toContain('class="spread"')
    expect(html).toContain('2019')
    expect(html).toContain('2024')
  })

  it('appears for a two-date contradiction, where the gap is the whole point', () => {
    const html = show({
      ...spread(['2019-03-01', '2023-11-15']),
      conflict: { kind: 'declared-disagreement', gapDays: 1720, detail: 'x' },
    })
    expect(html).toContain('class="spread"')
  })

  it('summarises itself for a screen reader instead of exposing bare dots', () => {
    const html = show(spread(['2019-01-01', '2021-06-01', '2024-03-01']))
    expect(html).toMatch(/aria-label="[^"]*dates found, spanning[^"]*"/)
    // The disclosure list below is already the accessible tabular view.
    expect(html).toContain('aria-hidden="true"></span>')
  })
})

describe('empty and cached states', () => {
  it('says finding nothing can be the right answer', () => {
    // A page with no date is a legitimate outcome, not a failure to report.
    expect(view(result(), 'https://danluu.com/x/', { now: NOW })).toContain(
      'sometimes the correct answer',
    )
  })

  it('offers a refresh only when showing a cached result', () => {
    expect(show(result(), { fromCache: true })).toContain('id="refresh"')
    expect(show(result())).not.toContain('id="refresh"')
  })

  it('always offers a way into settings', () => {
    expect(show(result())).toContain('id="open-settings"')
  })

  it('lists unresolved candidates separately from the chosen pair', () => {
    const chosen = candidate()
    const other = candidate({ value: '2019-01-01', source: 'url-slug', confidence: 'inferred' })
    const html = show(result({ published: chosen, candidates: [chosen, other] }))

    expect(html).toContain('1 other candidate')
    expect(html).not.toContain('1 other candidates')
  })
})

describe('the archive check is offered, never taken', () => {
  it('offers it only in ask mode', () => {
    const r = result({ published: candidate() })
    expect(show(r, { archive: 'ask' })).toContain('id="check-archive"')
    expect(show(r, { archive: 'off' })).not.toContain('id="check-archive"')
    // In "always" mode it has already run; there is nothing to offer.
    expect(show(r, { archive: 'always' })).not.toContain('id="check-archive"')
  })

  it('does not re-offer a check that already ran', () => {
    const html = show(result({ published: candidate() }), {
      archive: 'ask',
      archiveChecked: true,
    })
    expect(html).not.toContain('id="check-archive"')
    expect(html).toContain('records no edits')
  })
})
