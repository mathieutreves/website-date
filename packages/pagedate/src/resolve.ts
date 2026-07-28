import type { Candidate, Conflict, Confidence, DateResult, Precision } from './types.js'
import { toInstant } from './parse/normalize.js'
import { isPlausible } from './parse/plausibility.js'

const CONFIDENCE_RANK: Record<Confidence, number> = {
  declared: 3,
  derived: 2,
  inferred: 1,
}

const PRECISION_RANK: Record<Precision, number> = {
  minute: 4,
  day: 3,
  month: 2,
  year: 1,
}

/**
 * Tie-break between sources of equal confidence. Ordering reflects how often
 * each is deliberately maintained versus emitted as a build artefact.
 */
const SOURCE_RANK: Record<string, number> = {
  adapter: 100,
  jsonld: 90,
  'atom-feed': 85,
  opengraph: 80,
  // Below OpenGraph: a WebPage node's dates are frequently the site build
  // time rather than anything about the content.
  'jsonld-container': 75,
  itemprop: 70,
  'rss-feed': 65,
  'dublin-core': 60,
  citation: 55,
  parsely: 50,
  sailthru: 50,
  'time-tag': 45,
  'marked-date': 42,
  sitemap: 40,
  'meta-date': 35,
  'url-slug': 20,
  'visible-text': 15,
  // Below url-slug: an unlabelled date is weaker evidence than a date the
  // site committed to in its own URL structure.
  'text-date': 12,
  'http-last-modified': 10,
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Two `declared` values for one field further apart than this is a contradiction. */
const DECLARED_DISAGREEMENT_DAYS = 30

/** A publish date this far ahead of an unshown modification is a stale declaration. */
const STALE_DECLARATION_DAYS = 365

/** How much older page content must be than the declared date to count as evidence. */
const PREDATED_CONTENT_DAYS = 365

/**
 * How many independently dated elements must predate the declared publication
 * date before it is called out.
 *
 * Set high enough that an article legitimately *discussing* older events, with
 * a stray dated element or two, does not trip it — the signal we want is a body
 * of timestamps that could not exist yet, such as reader comments.
 */
const PREDATED_CONTENT_MIN_COUNT = 3

/** Exported so the corpus evaluation can rank within a tier the same way. */
export function rankCandidate(c: Candidate): number {
  return rank(c)
}

function rank(c: Candidate): number {
  return (
    CONFIDENCE_RANK[c.confidence] * 10_000 +
    (SOURCE_RANK[c.source] ?? 30) * 10 +
    PRECISION_RANK[c.precision]
  )
}

function best(candidates: Candidate[]): Candidate | undefined {
  if (candidates.length === 0) return undefined
  return candidates.reduce((a, b) => (rank(b) > rank(a) ? b : a))
}

function gapDays(a: Candidate, b: Candidate): number {
  const ia = toInstant(a.value)
  const ib = toInstant(b.value)
  if (!ia || !ib) return 0
  return Math.abs(ia.getTime() - ib.getTime()) / DAY_MS
}

export type ResolveOptions = {
  now?: Date
  /**
   * Archive edit events, when a timeline was fetched. Used only to detect
   * `stale-declaration`; never merged into `published`/`modified`.
   */
  archiveLastEdit?: string
}

/**
 * Rank candidates into a published/modified pair and flag contradictions.
 *
 * `published` and `modified` merely *differing* is normal and is deliberately
 * not a conflict — that distinction is what stops the flag being permanently
 * lit and therefore ignorable. See docs/DESIGN.md §4.8.
 */
export function resolveCandidates(
  candidates: Candidate[],
  options: ResolveOptions = {},
): DateResult {
  const now = options.now ?? new Date()
  const usable = candidates.filter((c) => isPlausible(c, now))

  const published = usable.filter((c) => c.field === 'published')
  const modified = usable.filter((c) => c.field === 'modified')
  const unknown = usable.filter((c) => c.field === 'unknown')

  let resolvedPublished = best(published)
  const resolvedModified = best(modified)

  // An unlabelled date is more likely to be the publication date than the
  // modification date — sites that bother to distinguish usually label the edit.
  if (!resolvedPublished && unknown.length > 0) {
    const promoted = best(unknown)
    if (promoted) {
      const modifiedInstant = resolvedModified ? toInstant(resolvedModified.value) : null
      const promotedInstant = toInstant(promoted.value)
      const notAfterModified =
        !modifiedInstant || !promotedInstant || promotedInstant <= modifiedInstant

      if (notAfterModified) {
        resolvedPublished = { ...promoted, field: 'published', note: unlabelledNote(promoted) }
      }
    }
  }

  const result: DateResult = { candidates: usable }
  if (resolvedPublished) result.published = resolvedPublished
  if (resolvedModified) result.modified = resolvedModified

  const conflict = detectConflict({
    published,
    modified,
    all: usable,
    resolvedPublished,
    resolvedModified,
    archiveLastEdit: options.archiveLastEdit,
  })
  if (conflict) result.conflict = conflict

  return result
}

function unlabelledNote(c: Candidate): string {
  return c.note ? `${c.note} (unlabelled, read as published)` : 'unlabelled, read as published'
}

function detectConflict(input: {
  published: Candidate[]
  modified: Candidate[]
  all: Candidate[]
  resolvedPublished: Candidate | undefined
  resolvedModified: Candidate | undefined
  archiveLastEdit: string | undefined
}): Conflict | undefined {
  const { published, modified, all, resolvedPublished, resolvedModified, archiveLastEdit } = input

  // (a) The site contradicts itself: two things it declared don't agree.
  for (const group of [published, modified]) {
    const declared = group.filter((c) => c.confidence === 'declared')
    for (let i = 0; i < declared.length; i++) {
      for (let j = i + 1; j < declared.length; j++) {
        const a = declared[i]!
        const b = declared[j]!
        const gap = gapDays(a, b)
        if (gap > DECLARED_DISAGREEMENT_DAYS) {
          return {
            kind: 'declared-disagreement',
            gapDays: Math.round(gap),
            detail: `${a.source} says ${a.value}, ${b.source} says ${b.value} for the same field.`,
          }
        }
      }
    }
  }

  // (b) The page carries content older than the date it claims to be from.
  // A timestamp cannot precede the thing it belongs to: readers cannot comment
  // on an article before it exists. So a body of dated elements older than the
  // declared publication date means that date is a republication or CMS
  // migration stamp, not when the content was written.
  if (resolvedPublished?.confidence === 'declared') {
    const declaredAt = toInstant(resolvedPublished.value)
    if (declaredAt) {
      const older = all.filter((c) => {
        if (c === resolvedPublished) return false
        // Only machine-readable timestamps count. Dates lifted from prose are
        // too often a mention of a past event rather than a page's own date.
        if (c.confidence === 'inferred') return false
        const at = toInstant(c.value)
        return at !== null && (declaredAt.getTime() - at.getTime()) / DAY_MS > PREDATED_CONTENT_DAYS
      })

      const distinct = new Set(older.map((c) => c.value.slice(0, 10)))
      if (distinct.size >= PREDATED_CONTENT_MIN_COUNT) {
        const oldest = older.reduce((a, b) =>
          (toInstant(b.value)?.getTime() ?? 0) < (toInstant(a.value)?.getTime() ?? 0) ? b : a,
        )
        const gap = (declaredAt.getTime() - (toInstant(oldest.value)?.getTime() ?? 0)) / DAY_MS

        return {
          kind: 'predated-content',
          gapDays: Math.round(gap),
          detail: `Declares ${resolvedPublished.value.slice(0, 10)}, but carries ${distinct.size} dated elements from before then, back to ${oldest.value.slice(0, 10)}. The declared date is likely a republication, not when this was written.`,
        }
      }
    }
  }

  // (c) The stale-declaration case: a publish date long predates evidence of
  // modification that the page itself doesn't show.
  if (resolvedPublished && !resolvedModified && archiveLastEdit) {
    const publishedInstant = toInstant(resolvedPublished.value)
    const editInstant = toInstant(archiveLastEdit)
    if (publishedInstant && editInstant) {
      const gap = (editInstant.getTime() - publishedInstant.getTime()) / DAY_MS
      if (gap > STALE_DECLARATION_DAYS) {
        return {
          kind: 'stale-declaration',
          gapDays: Math.round(gap),
          detail: `Page declares ${resolvedPublished.value} and shows no update, but the archive records a change on ${archiveLastEdit.slice(0, 10)}.`,
        }
      }
    }
  }

  return undefined
}
