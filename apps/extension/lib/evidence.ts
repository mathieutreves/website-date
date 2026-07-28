import { toInstant, type Candidate, type DateResult } from 'pagedate'

/**
 * The date a contradicting page is talking over.
 *
 * When `predated-content` fires, the declared date is a republication or CMS
 * migration stamp and the content is genuinely older — so the declared date,
 * shown alone, is the page's claim rather than the answer. The oldest hard
 * timestamp it carries is the closer thing to when the content was written,
 * and is what a reader actually wants.
 *
 * Two rules make this honest rather than just "the smallest number we found":
 *
 *   1. `inferred` candidates are excluded, exactly as the library excludes them
 *      when detecting the conflict. A date lifted from prose is usually an
 *      article *mentioning* 2014, not evidence of being written in 2014.
 *   2. It must be meaningfully older. A candidate a few days earlier is
 *      ordinary page noise and adds nothing next to the declared date.
 *
 * `stale-declaration` returns nothing here, and should: that conflict means the
 * page is *newer* than it admits, its evidence is an archive capture rather
 * than a candidate, and there is no older date to surface.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Below this the two dates are the same story told twice. */
const MEANINGFUL_GAP_DAYS = 30

export function oldestCounterEvidence(result: DateResult): Candidate | null {
  if (!result.conflict) return null

  const declared = result.published ?? result.modified
  if (!declared) return null

  const declaredAt = toInstant(declared.value)
  if (!declaredAt) return null

  let oldest: { candidate: Candidate; at: Date } | null = null

  for (const candidate of result.candidates) {
    if (candidate === declared) continue
    if (candidate.confidence === 'inferred') continue

    const at = toInstant(candidate.value)
    if (!at) continue
    if ((declaredAt.getTime() - at.getTime()) / DAY_MS < MEANINGFUL_GAP_DAYS) continue

    if (!oldest || at.getTime() < oldest.at.getTime()) oldest = { candidate, at }
  }

  return oldest?.candidate ?? null
}
