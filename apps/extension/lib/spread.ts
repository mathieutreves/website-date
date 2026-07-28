import { toInstant, type Candidate, type DateResult } from 'pagedate'

/**
 * Geometry for the evidence axis. Pure arithmetic, no DOM — the shape of this
 * data is what the tests assert on, not the markup that renders it.
 *
 * Why a horizontal axis rather than a vertical timeline: the candidates are not
 * events in a sequence, they are competing claims about one event, and the
 * quantity that matters is how far apart they are. A vertical list spaces rows
 * evenly, so a twelve-year gap and a two-day gap look identical — which is
 * precisely the distinction `predated-content` exists to report.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export type SpreadRole = 'published' | 'modified' | 'other'

export type SpreadPoint = {
  candidate: Candidate
  /** Position along the axis, 0 (oldest) to 1 (newest). */
  x: number
  role: SpreadRole
  /** How many candidates collapsed into this point. */
  count: number
}

export type Spread = {
  points: SpreadPoint[]
  from: string
  to: string
  spanDays: number
  /** Localised, e.g. "12 years". */
  spanLabel: string
  /** Distinct dates represented, before collapsing. */
  total: number
}

/** "12 years", "8 months", "23 days" — via Intl, so it translates for free. */
export function spanLabel(days: number): string {
  const [value, unit]: [number, Intl.NumberFormatOptions['unit']] =
    days >= 365
      ? [Math.round(days / 365.25), 'year']
      : days >= 45
        ? [Math.round(days / 30.44), 'month']
        : [Math.max(1, Math.round(days)), 'day']

  try {
    return new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'long' }).format(
      value,
    )
  } catch {
    return `${value} ${unit}s`
  }
}

/**
 * Collapse to one point per calendar day, keeping the strongest claim.
 *
 * Pages that trip `predated-content` do so because they carry dozens of dated
 * comments, often several on one day. Plotting every one buries the declared
 * date under a smear of overlapping dots and says nothing the count does not.
 */
const CONFIDENCE_ORDER = { declared: 3, derived: 2, inferred: 1 } as const

export function computeSpread(result: DateResult): Spread | null {
  const dated = result.candidates
    .map((candidate) => ({ candidate, at: toInstant(candidate.value) }))
    .filter((entry): entry is { candidate: Candidate; at: Date } => entry.at !== null)

  if (dated.length < 2) return null

  const byDay = new Map<string, { candidate: Candidate; at: Date; count: number }>()
  for (const entry of dated) {
    const day = entry.candidate.value.slice(0, 10)
    const existing = byDay.get(day)
    if (!existing) {
      byDay.set(day, { ...entry, count: 1 })
      continue
    }
    existing.count += 1
    const stronger =
      CONFIDENCE_ORDER[entry.candidate.confidence] >
      CONFIDENCE_ORDER[existing.candidate.confidence]
    if (stronger) existing.candidate = entry.candidate
  }

  const collapsed = [...byDay.values()].sort((a, b) => a.at.getTime() - b.at.getTime())
  if (collapsed.length < 2) return null

  const first = collapsed[0]!
  const last = collapsed[collapsed.length - 1]!
  const range = last.at.getTime() - first.at.getTime()

  // Everything landed on one day. There is no spread to draw, and a single
  // dot on an axis implies a precision the data does not have.
  if (range <= 0) return null

  const roleOf = (candidate: Candidate): SpreadRole =>
    candidate === result.published ? 'published' : candidate === result.modified ? 'modified' : 'other'

  return {
    points: collapsed.map((entry) => ({
      candidate: entry.candidate,
      x: (entry.at.getTime() - first.at.getTime()) / range,
      role: roleOf(entry.candidate),
      count: entry.count,
    })),
    from: first.candidate.value.slice(0, 10),
    to: last.candidate.value.slice(0, 10),
    spanDays: Math.round(range / DAY_MS),
    spanLabel: spanLabel(range / DAY_MS),
    total: collapsed.length,
  }
}

/**
 * Whether the axis earns its space.
 *
 * On a page with one clean date there is nothing to compare, and a chart of a
 * single fact is decoration. Three or more distinct dates, or any contradiction
 * at all, is when the spread carries information.
 */
export const isSpreadWorthShowing = (spread: Spread | null, result: DateResult): boolean =>
  spread !== null && (spread.total >= 3 || result.conflict !== undefined)
