import type { Candidate } from '../types.js'
import { toInstant } from './normalize.js'

/** Nothing on the web predates this in any meaningful sense. */
const EARLIEST_YEAR = 1995

/** Clock skew and timezone slop between us and the server. */
const FUTURE_TOLERANCE_MS = 48 * 60 * 60 * 1000

/**
 * A timestamp this close to now is a render timestamp, not a publication date.
 * Applies only to minute-precision candidates — a *day*-precision candidate
 * matching today is just something published today.
 */
const RENDER_TIMESTAMP_WINDOW_MS = 60 * 1000

export type PlausibilityVerdict = { ok: true } | { ok: false; reason: string }

export function checkPlausibility(candidate: Candidate, now: Date): PlausibilityVerdict {
  const instant = toInstant(candidate.value)
  if (!instant) return { ok: false, reason: 'unparseable value' }

  if (instant.getUTCFullYear() < EARLIEST_YEAR) {
    return { ok: false, reason: `before ${EARLIEST_YEAR}` }
  }

  const delta = instant.getTime() - now.getTime()
  if (delta > FUTURE_TOLERANCE_MS) return { ok: false, reason: 'in the future' }

  if (candidate.precision === 'minute' && Math.abs(delta) < RENDER_TIMESTAMP_WINDOW_MS) {
    return { ok: false, reason: 'looks like a render timestamp' }
  }

  return { ok: true }
}

export function isPlausible(candidate: Candidate, now: Date): boolean {
  return checkPlausibility(candidate, now).ok
}
