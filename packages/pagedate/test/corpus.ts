import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Candidate, DateResult, Env } from '../src/types.js'
import { rankCandidate } from '../src/resolve.js'
import { documentFrom } from './helpers.js'
import { DOMParser } from 'linkedom'

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures')

export type Fixture = {
  slug: string
  url: string
  notes: string
  knownMiss?: string
  /** Exact URL the feed was captured from, recorded at capture time. */
  fetchedFeedUrl?: string | null
  expect: { published: string | null; modified: string | null; conflict: string | null }
  html: string
  headers: Record<string, string>
  feed?: string
  sitemap?: string
}

export function loadFixtures(): Fixture[] {
  if (!existsSync(FIXTURES_DIR)) return []

  const out: Fixture[] = []
  for (const slug of readdirSync(FIXTURES_DIR)) {
    const dir = join(FIXTURES_DIR, slug)
    const expectedPath = join(dir, 'expected.json')
    const htmlPath = join(dir, 'page.html')
    if (!existsSync(expectedPath) || !existsSync(htmlPath)) continue

    const meta = JSON.parse(readFileSync(expectedPath, 'utf8')) as Omit<Fixture, 'slug' | 'html'>
    const fixture: Fixture = {
      slug,
      url: meta.url,
      notes: meta.notes,
      expect: meta.expect,
      html: readFileSync(htmlPath, 'utf8'),
      headers: existsSync(join(dir, 'headers.json'))
        ? (JSON.parse(readFileSync(join(dir, 'headers.json'), 'utf8')) as Record<string, string>)
        : {},
    }
    if (meta.knownMiss) fixture.knownMiss = meta.knownMiss
    if (meta.fetchedFeedUrl) fixture.fetchedFeedUrl = meta.fetchedFeedUrl
    if (existsSync(join(dir, 'feed.xml'))) fixture.feed = readFileSync(join(dir, 'feed.xml'), 'utf8')
    if (existsSync(join(dir, 'sitemap.xml'))) {
      fixture.sitemap = readFileSync(join(dir, 'sitemap.xml'), 'utf8')
    }
    out.push(fixture)
  }

  return out.sort((a, b) => a.slug.localeCompare(b.slug))
}

/**
 * Replays the captured side documents. Any URL the library asks for that wasn't
 * captured resolves to null rather than throwing — a feed we never saved is a
 * feed that legitimately isn't there, not a test-harness failure.
 */
export function fixtureEnv(fixture: Fixture): Env {
  return {
    fetchText: async (url) => {
      // Match the exact URL the feed was captured from. Pattern-matching on the
      // URL shape silently failed for feeds at unconventional paths such as
      // simonwillison.net/atom/everything/, which reads as a library miss when
      // it is really a harness miss.
      if (fixture.feed && fixture.fetchedFeedUrl && url === fixture.fetchedFeedUrl) {
        return fixture.feed
      }
      if (fixture.sitemap && /sitemap/i.test(url)) return fixture.sitemap
      return null
    },
    fetchHeaders: async () => fixture.headers,
    parseXml: (xml) => {
      try {
        return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
      } catch {
        return null
      }
    },
  }
}

export function fixtureDocument(fixture: Fixture): Document {
  return documentFrom(fixture.html)
}

/** htmldate normalises to %Y-%m-%d before comparing; matching that keeps us honest. */
export const toDay = (value: string | null | undefined): string | null =>
  value ? value.slice(0, 10) : null

export type Outcome = 'tp' | 'fp' | 'fn' | 'tn'

/**
 * Score one field against ground truth.
 *
 * `tn` — correctly returning nothing for a page that genuinely has no date — is
 * the case htmldate's corpus excludes by construction ("1000 web pages
 * containing identifiable dates"), so their accuracy figure can never reward it.
 * It matters here because returning nothing is a legitimate correct answer.
 */
export function score(expected: string | null, actual: string | null): Outcome {
  if (expected === null) return actual === null ? 'tn' : 'fp'
  if (actual === null) return 'fn'
  return actual === expected ? 'tp' : 'fp'
}

export type Counts = Record<Outcome, number>

export const emptyCounts = (): Counts => ({ tp: 0, fp: 0, fn: 0, tn: 0 })

export type Metrics = {
  precision: number
  recall: number
  accuracy: number
  f1: number
  n: number
}

/** Formulas taken from htmldate's tests/comparison.py so the shapes are comparable. */
export function metrics(c: Counts): Metrics {
  const precision = c.tp + c.fp === 0 ? 0 : c.tp / (c.tp + c.fp)
  const recall = c.tp + c.fn === 0 ? 0 : c.tp / (c.tp + c.fn)
  const total = c.tp + c.tn + c.fp + c.fn
  return {
    precision,
    recall,
    accuracy: total === 0 ? 0 : (c.tp + c.tn) / total,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    n: total,
  }
}

/**
 * Per-confidence-tier hit rate.
 *
 * This is the number the whole design rests on: if `declared` and `inferred`
 * are right about equally often, the confidence tiering is decorative and the
 * central premise of the library is wrong. No single-date benchmark measures it.
 */
export type Calibration = Record<string, { correct: number; total: number }>

/**
 * Scores one page per tier, not one candidate per tier: "if I trusted only
 * `declared` candidates on this page, would I have been right?"
 *
 * Scoring every candidate individually punishes multi-entity pages unfairly — a
 * Stack Overflow thread yields thirty answer timestamps, twenty-nine of which
 * are neither the question's date nor an error. They are different entities.
 */
export function calibrate(
  cal: Calibration,
  candidates: Candidate[],
  expected: { published: string | null; modified: string | null },
): void {
  for (const tier of ['declared', 'derived', 'inferred'] as const) {
    for (const field of ['published', 'modified'] as const) {
      const truth = expected[field]
      if (truth === null) continue

      const inTier = candidates.filter((c) => c.confidence === tier && c.field === field)
      if (inTier.length === 0) continue

      const top = inTier.reduce((a, b) => (rankCandidate(b) > rankCandidate(a) ? b : a))
      const bucket = (cal[tier] ??= { correct: 0, total: 0 })
      bucket.total++
      if (toDay(top.value) === truth) bucket.correct++
    }
  }
}

export const pct = (n: number): string => (n * 100).toFixed(1).padStart(5)

export function formatTable(rows: Array<{ label: string; counts: Counts }>): string {
  const header =
    '  field         n   TP  FP  FN  TN | precision  recall  accuracy  F-score'
  const lines = [header, `  ${'-'.repeat(header.length - 4)}`]

  for (const { label, counts } of rows) {
    const m = metrics(counts)
    lines.push(
      `  ${label.padEnd(10)} ${String(m.n).padStart(3)}  ` +
        `${String(counts.tp).padStart(3)} ${String(counts.fp).padStart(3)} ` +
        `${String(counts.fn).padStart(3)} ${String(counts.tn).padStart(3)} | ` +
        `${pct(m.precision)}%   ${pct(m.recall)}%   ${pct(m.accuracy)}%    ${pct(m.f1)}%`,
    )
  }

  return lines.join('\n')
}

export type Evaluated = {
  fixture: Fixture
  result: DateResult
  published: Outcome
  modified: Outcome
}
