import { describe, expect, it } from 'vitest'
import { findDates } from '../src/index.js'
import {
  calibrate,
  emptyCounts,
  fixtureDocument,
  fixtureEnv,
  formatTable,
  loadFixtures,
  metrics,
  pct,
  score,
  toDay,
  type Calibration,
  type Counts,
  type Evaluated,
} from './corpus.js'

/**
 * Corpus evaluation.
 *
 * Reports the same metric shapes htmldate publishes, plus two things a
 * single-date benchmark structurally cannot express: true negatives, and
 * whether the confidence tiers are calibrated.
 *
 * This suite deliberately does NOT assert per-fixture correctness. Known misses
 * are recorded in each fixture's `knownMiss` field and are expected to fail
 * until the relevant extractor exists; what is asserted is that the aggregate
 * never regresses below the recorded baseline.
 */

/** Ratchet upward as extractors land. Never lower it to make a change pass. */
const BASELINE = {
  publishedAccuracy: 1.0,
  modifiedAccuracy: 0.9,
}

const fixtures = loadFixtures()

describe('corpus evaluation', () => {
  it.runIf(fixtures.length > 0)('reports metrics and does not regress', async () => {
    const evaluated: Evaluated[] = []
    const publishedCounts: Counts = emptyCounts()
    const modifiedCounts: Counts = emptyCounts()
    const calibration: Calibration = {}

    for (const fixture of fixtures) {
      const result = await findDates(
        fixtureDocument(fixture),
        fixture.url,
        fixtureEnv(fixture),
        // Fixed relative to capture date so plausibility stays deterministic.
        { now: new Date('2026-07-29T00:00:00Z') },
      )

      const published = score(fixture.expect.published, toDay(result.published?.value))
      const modified = score(fixture.expect.modified, toDay(result.modified?.value))

      publishedCounts[published]++
      modifiedCounts[modified]++
      calibrate(calibration, result.candidates, fixture.expect)
      evaluated.push({ fixture, result, published, modified })
    }

    report(evaluated, publishedCounts, modifiedCounts, calibration)

    const pubAccuracy = metrics(publishedCounts).accuracy
    const modAccuracy = metrics(modifiedCounts).accuracy

    expect(
      pubAccuracy,
      `published accuracy regressed below baseline ${BASELINE.publishedAccuracy}`,
    ).toBeGreaterThanOrEqual(BASELINE.publishedAccuracy)
    expect(
      modAccuracy,
      `modified accuracy regressed below baseline ${BASELINE.modifiedAccuracy}`,
    ).toBeGreaterThanOrEqual(BASELINE.modifiedAccuracy)
  })

  it('has a corpus at all', () => {
    // A silently empty corpus would let every other assertion here pass
    // vacuously, which is worse than having no evaluation.
    expect(fixtures.length, 'no fixtures captured — run `pnpm fixture <url>`').toBeGreaterThan(0)
  })
})

function report(
  evaluated: Evaluated[],
  published: Counts,
  modified: Counts,
  calibration: Calibration,
): void {
  const lines: string[] = ['', `CORPUS EVALUATION — ${evaluated.length} fixtures`, '']

  lines.push(
    formatTable([
      { label: 'published', counts: published },
      { label: 'modified', counts: modified },
    ]),
  )

  lines.push('', '  confidence tier calibration')
  lines.push('  ---------------------------')
  for (const tier of ['declared', 'derived', 'inferred']) {
    const bucket = calibration[tier]
    if (!bucket || bucket.total === 0) {
      lines.push(`  ${tier.padEnd(10)}      no candidates`)
      continue
    }
    lines.push(
      `  ${tier.padEnd(10)} ${pct(bucket.correct / bucket.total)}%  (${bucket.correct}/${bucket.total})`,
    )
  }

  lines.push('', '  per fixture')
  lines.push('  -----------')
  for (const { fixture, result, published: p, modified: m } of evaluated) {
    const mark = (o: string) => ({ tp: '✓', tn: '·', fp: '✗', fn: '○' })[o] ?? '?'
    const known = fixture.knownMiss ? '  [known miss]' : ''
    lines.push(
      `  ${mark(p)}${mark(m)} ${fixture.slug.padEnd(24)} ` +
        `pub=${(toDay(result.published?.value) ?? '—').padEnd(11)} ` +
        `mod=${(toDay(result.modified?.value) ?? '—').padEnd(11)}${known}`,
    )
  }

  lines.push('', '  ✓ hit   · correct empty   ✗ wrong   ○ missed', '')
  console.log(lines.join('\n'))
}
