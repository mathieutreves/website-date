import { describe, expect, it } from 'vitest'
import type { Candidate, DateResult } from 'pagedate'
import { overlayData, paintOverlay, clearOverlay, OVERLAY_ID } from '../lib/overlay.js'

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

const data = (r: DateResult | null, mode: 'never' | 'always' | 'conflict' = 'always') =>
  overlayData(r, NOW, mode, 'bottom-left')

describe('what the corner readout says', () => {
  it('carries the age and nothing else when collapsed', () => {
    // Being present on every page is what forces it to be this small.
    const shown = data(result({ published: candidate() }))
    expect(shown?.age).toMatch(/years ago/)
    expect(shown?.age).not.toMatch(/JSON-LD|stated by/)
  })

  it('keeps provenance for the expanded state', () => {
    const shown = data(result({ published: candidate() }))
    expect(shown?.detail).toContain('stated by the site')
    expect(shown?.detail).toContain('JSON-LD metadata')
  })

  it('says "no date" quietly rather than disappearing', () => {
    // Absence is information. Vanishing would be ambiguous with not having run.
    const shown = data(result())
    expect(shown?.age).toBe('no date')
    expect(shown?.muted).toBe(true)
  })

  it('shows nothing at all when the page could not be read', () => {
    // Here we genuinely do not know, and "no date" would claim we had looked.
    expect(data(null)).toBeNull()
  })

  it('falls back to the modification date, labelled as such', () => {
    const shown = data(result({ modified: candidate({ field: 'modified' }) }))
    expect(shown?.detail).toContain('Last modified')
  })
})

describe('escalating inside the readout', () => {
  it('stays quiet on an ordinary page', () => {
    const shown = data(result({ published: candidate() }))
    expect(shown?.tone).toBe('normal')
    expect(shown?.conflict).toBeNull()
  })

  it('turns the constant readout into the alert when the date is undermined', () => {
    const shown = data(
      result({
        published: candidate(),
        conflict: { kind: 'predated-content', gapDays: 900, detail: 'x' },
      }),
    )
    expect(shown?.tone).toBe('alert')
    expect(shown?.conflict).toContain('older than it says')
  })

  it('uses the softer tone when the date is right but incomplete', () => {
    const shown = data(
      result({
        published: candidate(),
        conflict: { kind: 'stale-declaration', gapDays: 900, detail: 'x' },
      }),
    )
    expect(shown?.tone).toBe('notice')
  })
})

describe('modes', () => {
  it('shows nothing when off', () => {
    expect(data(result({ published: candidate() }), 'never')).toBeNull()
  })

  it('in conflict-only mode, appears solely when there is one', () => {
    expect(data(result({ published: candidate() }), 'conflict')).toBeNull()
    expect(
      data(
        result({
          published: candidate(),
          conflict: { kind: 'predated-content', gapDays: 900, detail: 'x' },
        }),
        'conflict',
      ),
    ).not.toBeNull()
  })
})

describe('the injected functions survive serialisation', () => {
  // executeScript ships these as source text, so anything they close over —
  // an import, a module constant — is simply not defined when they run.
  const bodies = [paintOverlay.toString(), clearOverlay.toString()]

  it('reference no module-scope identifiers', () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/\bOVERLAY_ID\b/)
      expect(body).not.toMatch(/\bt\(/)
      expect(body).not.toMatch(/\bimport\b/)
    }
  })

  it('write the shared element id out literally in both', () => {
    for (const body of bodies) expect(body).toContain(OVERLAY_ID)
  })
})
