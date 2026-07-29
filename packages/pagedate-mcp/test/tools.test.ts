import { describe, expect, it } from 'vitest'
import type { Candidate, DateResult } from 'pagedate'
import { pageDate, pageFreshness, renderDates, type Analyse } from '../src/tools.js'

const NOW = new Date('2026-07-28T12:00:00Z')
const URL_ = 'https://example.com/post'

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  value: '2024-03-12',
  precision: 'day',
  field: 'published',
  source: 'jsonld',
  confidence: 'declared',
  ...over,
})

const serving = (result: DateResult | null): Analyse => async () => result

const text = (r: { content: { text: string }[] }): string => r.content[0]!.text

describe('renderDates', () => {
  it('names the source and the tier, not just the value', () => {
    const out = renderDates(URL_, { candidates: [], published: candidate() }, false)

    expect(out).toContain('2024-03-12')
    expect(out).toContain('declared by the site in machine-readable metadata')
    expect(out).toContain('source: jsonld')
  })

  it('says a coarse date is coarse', () => {
    const out = renderDates(
      URL_,
      { candidates: [], published: candidate({ value: '2024', precision: 'year' }) },
      false,
    )

    expect(out).toContain('only a year')
  })

  /*
   * The line this whole module exists for. A model that sees an empty field
   * treats the page as undated and undated as recent; it has to be told that
   * the absence is the finding.
   */
  it('spells out that a missing date is not evidence of recency', () => {
    const out = renderDates(URL_, { candidates: [] }, false)

    expect(out).toContain('not stated')
    expect(out).toMatch(/treat its age as unknown rather than recent/i)
  })

  it('leads with the conflict, before the dates', () => {
    const out = renderDates(
      URL_,
      {
        candidates: [],
        published: candidate({ value: '2019-03-04' }),
        conflict: {
          kind: 'stale-declaration',
          gapDays: 2070,
          detail: 'declared 2019-03-04 but the archive shows changed content on 2024-11-02',
          declared: '2019-03-04',
          archived: '2024-11-02',
        },
      },
      false,
    )

    expect(out.split('\n')[0]).toContain('WARNING')
    expect(out.indexOf('WARNING')).toBeLessThan(out.indexOf('Published:'))
    expect(out).toContain('rewritten since the date it claims')
  })

  it('lists candidates only when asked', () => {
    const result: DateResult = { candidates: [candidate()], published: candidate() }

    expect(renderDates(URL_, result, false)).not.toContain('All 1 date signals')
    expect(renderDates(URL_, result, true)).toContain('All 1 date signals')
  })
})

describe('page_date', () => {
  it('returns both prose and the structured result', async () => {
    const result = await pageDate({ url: URL_ }, serving({ candidates: [], published: candidate() }))

    expect(text(result)).toContain('2024-03-12')
    expect(result.structuredContent).toMatchObject({
      url: URL_,
      published: { value: '2024-03-12' },
    })
    expect(result.isError).toBeUndefined()
  })

  it('reports an unreachable page as an error, without implying anything about its age', async () => {
    const result = await pageDate({ url: URL_ }, serving(null))

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('No conclusion about its date should be drawn')
    expect(result.structuredContent).toMatchObject({ error: 'unreachable' })
  })

  it('passes mode and minConfidence through to the analyser', async () => {
    const seen: unknown[] = []
    const analyse: Analyse = async (_url, options) => {
      seen.push(options)
      return { candidates: [] }
    }

    await pageDate({ url: URL_, mode: 'fast', minConfidence: 'declared' }, analyse)
    expect(seen[0]).toEqual({ mode: 'fast', minConfidence: 'declared' })
  })

  it('omits absent options rather than passing undefined', async () => {
    const seen: unknown[] = []
    const analyse: Analyse = async (_url, options) => {
      seen.push(options)
      return { candidates: [] }
    }

    await pageDate({ url: URL_ }, analyse)
    expect(seen[0]).toEqual({})
  })
})

describe('page_freshness', () => {
  it('calls a recent page fresh', async () => {
    const result = await pageFreshness(
      { url: URL_, maxAgeDays: 180 },
      serving({ candidates: [], published: candidate({ value: '2026-07-01' }) }),
      NOW,
    )

    expect(text(result)).toMatch(/^FRESH/)
    expect(result.structuredContent).toMatchObject({ stale: false, reason: 'fresh' })
  })

  it('calls an old page stale', async () => {
    const result = await pageFreshness(
      { url: URL_, maxAgeDays: 180 },
      serving({ candidates: [], published: candidate({ value: '2019-03-04' }) }),
      NOW,
    )

    expect(text(result)).toMatch(/^STALE/)
    expect(result.structuredContent).toMatchObject({ stale: true, reason: 'stale' })
  })

  it('refuses to decide on an undated page, and says why that is not "recent"', async () => {
    const result = await pageFreshness({ url: URL_, maxAgeDays: 180 }, serving({ candidates: [] }), NOW)

    expect(text(result)).toMatch(/^UNDETERMINED/)
    expect(text(result)).toMatch(/absence of a date is not evidence that it is recent/i)
    expect(result.structuredContent).toMatchObject({ stale: null, reason: 'no-date' })
  })

  it('refuses to decide when the precision straddles the threshold', async () => {
    const result = await pageFreshness(
      { url: URL_, maxAgeDays: 180 },
      serving({ candidates: [], published: candidate({ value: '2026', precision: 'year' }) }),
      NOW,
    )

    expect(text(result)).toMatch(/^UNDETERMINED/)
    expect(text(result)).toMatch(/Do not report it as either current or outdated/i)
    expect(result.structuredContent).toMatchObject({ reason: 'imprecise' })
  })

  it('honours an explicit basis', async () => {
    const result = await pageFreshness(
      { url: URL_, maxAgeDays: 180, basis: 'published' },
      serving({
        candidates: [],
        published: candidate({ value: '2019-03-04' }),
        modified: candidate({ value: '2026-07-02', field: 'modified' }),
      }),
      NOW,
    )

    expect(result.structuredContent).toMatchObject({ stale: true, basis: 'published' })
  })

  it('still surfaces a conflict in the freshness answer', async () => {
    const result = await pageFreshness(
      { url: URL_, maxAgeDays: 180 },
      serving({
        candidates: [],
        published: candidate({ value: '2019-03-04' }),
        conflict: {
          kind: 'declared-disagreement',
          gapDays: 400,
          detail: 'jsonld says 2019-03-04, opengraph says 2020-04-08',
          earlier: { source: 'jsonld', value: '2019-03-04' },
          later: { source: 'opengraph', value: '2020-04-08' },
        },
      }),
      NOW,
    )

    expect(text(result)).toContain('contradicts itself')
  })

  it('mentions the confidence floor when one made the page undecidable', async () => {
    const result = await pageFreshness(
      { url: URL_, maxAgeDays: 180, minConfidence: 'declared' },
      serving({
        candidates: [],
        published: candidate({ confidence: 'inferred', source: 'url-slug' }),
      }),
      NOW,
    )

    expect(text(result)).toContain('"declared" confidence')
  })
})
