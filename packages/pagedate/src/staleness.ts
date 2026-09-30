/**
 * Is this page too old to use?
 *
 * The question almost every programmatic caller is actually asking. A retrieval
 * pipeline filtering scraped documents, a crawler deciding what to re-fetch, a
 * cache deciding what to trust — none of them want a date, they want a verdict,
 * and every one of them would otherwise write the same twenty lines of
 * `Date.now()` arithmetic against {@link DateResult}. Writing it here once means
 * it gets the two things a hand-rolled version reliably gets wrong.
 *
 * **Coarse precision is an interval, not a point.** A page that said "2024"
 * yields `{ value: '2024', precision: 'year' }`, and the instant it refers to
 * lies anywhere in a 366-day window. Against a 180-day threshold that window
 * has no answer: part of it is stale and part of it is not. `toInstant` resolves
 * a partial value to the *start* of its period, which is right for gap
 * arithmetic and wrong here — it would silently report the oldest reading as if
 * it were the only one. So this module works in intervals and reports
 * `stale: null` when the interval straddles the threshold, for the same reason
 * the extractors report `precision: 'year'` instead of inventing a January 1st.
 *
 * **Which date counts is the caller's decision.** `modified` is the right basis
 * for "has this been kept current"; `published` is the right basis for "when was
 * this written". Defaulting to one silently would make the other caller wrong.
 * {@link StalenessOptions.basis} defaults to `'either'`, which prefers
 * `modified` and falls back to `published` — the reading that matches "how old
 * is what I am looking at", and the one worth being explicit about.
 */

import type { Candidate, Confidence, DateResult } from './types.js'
import { toInstant } from './parse/normalize.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** Which of the two dates decides the verdict. */
export type StalenessBasis = 'modified' | 'published' | 'either'

export type StalenessOptions = {
  /** A page older than this many days is stale. Required: there is no sane default. */
  maxAgeDays: number
  /** Fixed clock, for reproducible runs and tests. */
  now?: Date
  /** Defaults to `'either'`: `modified` when the page has one, else `published`. */
  basis?: StalenessBasis
  /**
   * Ignore dates below this tier when deciding.
   *
   * `'declared'` means the verdict rests only on what the site stated in
   * machine-readable metadata, and a page whose only date came from its URL or
   * its prose becomes undecidable rather than answered on a guess. Worth setting
   * when the cost of wrongly keeping a stale document is high.
   */
  minConfidence?: Confidence
}

export type StalenessReason =
  /** Inside the threshold at every instant its precision allows. */
  | 'fresh'
  /** Outside the threshold at every instant its precision allows. */
  | 'stale'
  /**
   * The date's precision straddles the threshold — it is stale on one reading
   * and fresh on another, and the page did not say which. Widen `maxAgeDays`,
   * or treat it as undecided.
   */
  | 'imprecise'
  /** No date survived `basis` and `minConfidence`. */
  | 'no-date'

export type Staleness = {
  /** `null` when the answer is genuinely unavailable — see {@link StalenessReason}. */
  stale: boolean | null
  reason: StalenessReason
  /**
   * Days since the *newest* instant the date's precision allows: the page's
   * minimum possible age. Equal to {@link maxAgeDays} at minute precision.
   */
  ageDays: number | null
  /** Days since the oldest instant its precision allows: the maximum possible age. */
  maxAgeDays: number | null
  /** Which field the verdict rests on, and the candidate it came from. */
  basis: 'modified' | 'published' | null
  used?: Candidate
}

/**
 * Half-open interval `[start, end)` of instants a candidate's value could mean.
 *
 * Exported because "how imprecise is this, in real time" is a question callers
 * ask for reasons other than staleness — deciding whether two candidates can be
 * proven to disagree, for one.
 */
export function toInterval(candidate: Candidate): { start: Date; end: Date } | null {
  const start = toInstant(candidate.value)
  if (!start || Number.isNaN(start.getTime())) return null

  const end = new Date(start.getTime())
  switch (candidate.precision) {
    case 'year':
      end.setUTCFullYear(end.getUTCFullYear() + 1)
      break
    case 'month':
      end.setUTCMonth(end.getUTCMonth() + 1)
      break
    case 'day':
      end.setUTCDate(end.getUTCDate() + 1)
      break
    case 'minute':
      // The value names a minute, so anything inside it is the same reading.
      // Kept as an interval rather than a point so the arithmetic below has no
      // special case, and because a caller comparing two minute-precision dates
      // a few seconds apart should not be told they disagree.
      end.setUTCSeconds(end.getUTCSeconds() + 60)
      break
  }

  return { start, end }
}

/** Null-prototype for the reason given in `resolve.ts`. */
const CONFIDENCE_RANK: Record<Confidence, number> = Object.assign(Object.create(null), {
  declared: 3,
  derived: 2,
  inferred: 1,
})

const atLeast = (actual: Confidence, floor: Confidence): boolean =>
  (CONFIDENCE_RANK[actual] ?? 0) >= (CONFIDENCE_RANK[floor] ?? 0)

function pick(
  result: DateResult,
  basis: StalenessBasis,
  floor?: Confidence,
): { field: 'modified' | 'published'; candidate: Candidate } | null {
  const usable = (c: Candidate | undefined): c is Candidate =>
    c !== undefined && (!floor || atLeast(c.confidence, floor))

  if (basis !== 'published' && usable(result.modified)) {
    return { field: 'modified', candidate: result.modified }
  }
  if (basis !== 'modified' && usable(result.published)) {
    return { field: 'published', candidate: result.published }
  }
  return null
}

const NOTHING: Staleness = {
  stale: null,
  reason: 'no-date',
  ageDays: null,
  maxAgeDays: null,
  basis: null,
}

/**
 * How old a page is, and whether that exceeds a threshold.
 *
 * ```js
 * const s = staleness(result, { maxAgeDays: 180 })
 * // { stale: false, reason: 'fresh', ageDays: 12, maxAgeDays: 12, basis: 'modified', used: {…} }
 * ```
 *
 * Use this when you want to log or explain the verdict. {@link isStale} is the
 * one-line form for when you only want to filter.
 */
export function staleness(result: DateResult, options: StalenessOptions): Staleness {
  const now = options.now ?? new Date()
  const chosen = pick(result, options.basis ?? 'either', options.minConfidence)
  if (!chosen) return { ...NOTHING }

  const interval = toInterval(chosen.candidate)
  // A candidate whose value will not parse is not evidence of anything. This
  // should be unreachable through the extractors, which only ever emit values
  // they built themselves, but `resolveCandidates` is exported and an Adapter
  // supplies `value` as a free-form string.
  if (!interval) return { ...NOTHING }

  // Youngest possible instant gives the smallest age, and vice versa. `end` is
  // exclusive, so the youngest instant actually inside the interval is one
  // millisecond before it — immaterial to a day count, but it keeps a page
  // stamped exactly at the threshold from rounding to the wrong side.
  const ageDays = (now.getTime() - (interval.end.getTime() - 1)) / DAY_MS
  const maxAgeDays = (now.getTime() - interval.start.getTime()) / DAY_MS

  const base = {
    ageDays: Math.floor(ageDays),
    maxAgeDays: Math.floor(maxAgeDays),
    basis: chosen.field,
    used: chosen.candidate,
  }

  // A page dated in the future has a negative age. It is not stale, and saying
  // so is more useful than inventing an error for it: `predated-content` and the
  // plausibility filter are where implausible dates get judged, not here.
  if (maxAgeDays <= options.maxAgeDays) return { stale: false, reason: 'fresh', ...base }
  if (ageDays > options.maxAgeDays) return { stale: true, reason: 'stale', ...base }
  return { stale: null, reason: 'imprecise', ...base }
}

export type IsStaleOptions = StalenessOptions & {
  /**
   * The verdict for a page whose age cannot be decided — no date, or a date too
   * imprecise to place. Defaults to `true`.
   *
   * `true` is the right default for the job this function exists for: filtering
   * a corpus, where letting an undated document through is how a
   * three-year-old page ends up quoted as current. Callers ranking rather than
   * filtering usually want `false`. Callers who care about the difference should
   * use {@link staleness} and read `reason`.
   */
  whenUnknown?: boolean
}

/**
 * `staleness()` reduced to the boolean a filter wants.
 *
 * ```js
 * const current = docs.filter((d) => !isStale(d.dates, { maxAgeDays: 365 }))
 * ```
 */
export function isStale(result: DateResult, options: IsStaleOptions): boolean {
  const verdict = staleness(result, options)
  return verdict.stale ?? options.whenUnknown ?? true
}
