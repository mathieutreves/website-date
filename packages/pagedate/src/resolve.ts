import type { Candidate, Conflict, Confidence, DateResult, Precision } from './types.js'
import { toInstant } from './parse/normalize.js'
import { isPlausible } from './parse/plausibility.js'

/**
 * The three ranking tables are null-prototype, and {@link rank} checks its
 * arithmetic, because all three are indexed by strings that arrive as data.
 * `Candidate.source` is a free-form `string` an {@link Adapter} supplies, and
 * `resolveCandidates` is exported for callers to drive directly. On a plain
 * object `SOURCE_RANK['constructor']` resolves to an inherited *function*
 * rather than `undefined`, so the `?? 30` fallback never fires, `rank()` returns
 * `NaN`, and every comparison against it is false — a candidate that silently
 * could never be picked. Neither table is hot enough for the prototype to be
 * worth that.
 */
const CONFIDENCE_RANK: Record<Confidence, number> = Object.assign(Object.create(null), {
  declared: 3,
  derived: 2,
  inferred: 1,
})

const PRECISION_RANK: Record<Precision, number> = Object.assign(Object.create(null), {
  minute: 4,
  day: 3,
  month: 2,
  year: 1,
})

/**
 * Tie-break between sources of equal confidence. Ordering reflects how often
 * each is deliberately maintained versus emitted as a build artefact.
 */
const SOURCE_RANK: Record<string, number> = Object.assign(Object.create(null), {
  adapter: 100,
  jsonld: 90,
  'atom-feed': 85,
  opengraph: 80,
  itemprop: 70,
  'rss-feed': 65,
  'dublin-core': 60,
  citation: 55,
  parsely: 50,
  sailthru: 50,
  'time-tag': 45,
  'marked-date': 42,
  // Below every reading of the page's own content. A `WebPage` or `WebSite`
  // node's date is usually the site build time, and on this corpus it is right
  // 1 time in 5 when it wins — so it is a last resort among `derived` sources
  // rather than a peer of them.
  'jsonld-container': 30,
  // Just below `marked-date`, and for the same reason: both are a site naming a
  // date in markup it authored. A class token is the more deliberate of the two
  // — it is written once in a template — while a visible field name is prose a
  // translator could change, so it ranks a hair lower.
  'labelled-pair': 41,
  sitemap: 40,
  'meta-date': 35,
  // Below the metadata a site publishes for consumers, above anything guessed
  // from rendered text: an inlined state blob is exact and site-authored, but it
  // is an implementation detail that no contract obliges the site to keep true.
  wordpress: 32,
  'inline-state': 31,
  'url-slug': 20,
  // Below url-slug: a post's URL is minted with the post, but the image it
  // previews with can be a stock banner uploaded years earlier.
  'image-path': 18,
  'visible-text': 15,
  // Below url-slug: an unlabelled date is weaker evidence than a date the
  // site committed to in its own URL structure.
  'text-date': 12,
  'http-last-modified': 10,
  // Bottom of the table, below everything. A frequency count over rendered text
  // knows nothing about what the page meant by any of it.
  'page-scan': 5,
})

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The real range of UTC offsets, Baker Island to Kiritimati.
 *
 * Used as a physical bound rather than a tuning knob: it is what decides whether
 * a one-day disagreement *could* be a timezone at all. See {@link localise}.
 */
const MIN_OFFSET_MIN = -12 * 60
const MAX_OFFSET_MIN = 14 * 60

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
  const score =
    CONFIDENCE_RANK[c.confidence] * 10_000 +
    (SOURCE_RANK[c.source] ?? 30) * 10 +
    PRECISION_RANK[c.precision]

  // An unrecognised confidence or precision — from an adapter, or a caller
  // driving `resolveCandidates` directly — leaves a `NaN` that loses every
  // comparison, which reads as "this candidate is never the best" rather than
  // as the malformed input it is. Rank it last, visibly and deterministically.
  return Number.isFinite(score) ? score : 0
}

/**
 * Pick the strongest candidate.
 *
 * Ties fall back to document order, which sounds arbitrary but was the best of
 * the options measured. Preferring the earliest date for a publication — on the
 * reasoning that publication precedes the comments and updates a page
 * accumulates — fixes pages where several unlabelled text dates compete, and
 * loses more pages than it fixes elsewhere. It was tried both broadly and
 * narrowed to the inferred tier, and lost one net page either way.
 */
function best(candidates: Candidate[]): Candidate | undefined {
  if (candidates.length === 0) return undefined
  return candidates.reduce((a, b) => (rank(b) > rank(a) ? b : a))
}

/** The zone a value carries, or `null` when it is timezone-naive. */
function zoneOf(value: string): string | null {
  const match = /T\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})?$/.exec(value)
  return match ? (match[1] ?? null) : null
}

const civilDay = (value: string): string => value.slice(0, 10)

const shiftDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

/** Render an instant at a given offset, to minute precision. */
function atOffset(instantMs: number, offsetMin: number): string {
  const shifted = new Date(instantMs + offsetMin * 60_000).toISOString()
  const sign = offsetMin < 0 ? '-' : '+'
  const abs = Math.abs(offsetMin)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${shifted.slice(0, 16)}${sign}${hh}:${mm}`
}

/**
 * Report the day the site says it published on, not the day UTC happens to fall on.
 *
 * A publication date is a civil date somewhere. A site that posts at 23:50 local
 * and stamps `2025-12-05T05:50Z` in its JSON-LD has not published on the 5th by
 * any account its own readers would recognise — the byline underneath says
 * December 4, and so does its permalink. Rendering the instant in UTC and
 * slicing off the day silently disagrees with the page about what the page said.
 *
 * So when the page carries its own rendering of the *same* date and the two
 * differ by exactly one day, the page wins. Two things may corroborate:
 *
 * - a timezone-naive timestamp whose difference from the declared instant is a
 *   whole quarter-hour inside the real range of UTC offsets — that is the same
 *   moment written in the site's own zone, and it hands us the offset, so the
 *   result keeps minute precision and gains the correct one;
 * - a day-precision candidate the markup explicitly labels as *this page's*
 *   publication date. That gives the day but not the offset, so the result drops
 *   to day precision rather than inventing one.
 *
 * Nothing else counts. Sidebar rails and neighbouring articles are full of
 * adjacent days, and letting an unlabelled one override a declared timestamp
 * loses more pages than it wins — measured, on this corpus, as many again.
 *
 * The near-midnight guard is arithmetic rather than a threshold: with offsets
 * bounded to [−12, +14], only a UTC hour before 12 can fall back a day, and only
 * one from 10 onwards can roll forward.
 */
function localise(published: Candidate, all: Candidate[]): Candidate | undefined {
  if (published.precision !== 'minute') return undefined
  const zone = zoneOf(published.value)
  if (zone !== 'Z' && zone !== '+00:00') return undefined

  const instant = toInstant(published.value)
  if (!instant) return undefined

  const utcDay = civilDay(published.value)
  const hour = instant.getUTCHours()
  const earlier = hour * 60 + instant.getUTCMinutes() + MIN_OFFSET_MIN < 0 ? shiftDay(utcDay, -1) : null
  const later = hour * 60 + instant.getUTCMinutes() + MAX_OFFSET_MIN >= 24 * 60 ? shiftDay(utcDay, 1) : null
  if (!earlier && !later) return undefined

  for (const c of all) {
    if (c === published || c.field === 'modified') continue

    if (c.precision === 'minute' && zoneOf(c.value) === null) {
      const local = toInstant(`${c.value}Z`)
      if (!local) continue
      const offsetMin = (local.getTime() - instant.getTime()) / 60_000
      if (offsetMin === 0 || offsetMin % 15 !== 0) continue
      if (offsetMin < MIN_OFFSET_MIN || offsetMin > MAX_OFFSET_MIN) continue
      const day = civilDay(c.value)
      if (day !== earlier && day !== later) continue
      return {
        ...published,
        value: atOffset(instant.getTime(), offsetMin),
        note: appendNote(published, `rendered in the site's own zone, per ${c.source}`),
      }
    }

    // `published` only, and that restriction is load-bearing rather than
    // incidental. Admitting `unknown` day candidates was measured twice and lost
    // both times: all of them takes dev accuracy 89.0% -> 87.4% (wrong 51 -> 65),
    // and narrowing to just the rendered date blocks — `marked-date`,
    // `labelled-pair` — still gives 88.0% (wrong 60), and both break fixtures.
    //
    // The reason is that an `unknown` day landing on the adjacent day is usually
    // coincidence, not corroboration: a page carries many dates, and this window
    // is only ±1 day wide, so something lands in it often. Individual pages do
    // lose to this — creativecommons.org declares `2023-07-21T02:51+00:00` and
    // prints "July 20, 2023" — but the pages it would fix are outnumbered by the
    // ones it breaks. That is a ±1 day boundary case, and CORPUS-BUILD.md's
    // conclusion holds: the answer key itself disagrees about local versus UTC,
    // so this is not a class of error extraction can win.
    if (c.precision === 'day' && c.field === 'published') {
      if (c.value !== earlier && c.value !== later) continue
      return {
        ...published,
        value: c.value,
        precision: 'day',
        note: appendNote(published, `day taken from ${c.source}, which the page states and UTC would shift`),
      }
    }
  }

  return undefined
}

const appendNote = (c: Candidate, extra: string): string => (c.note ? `${c.note} — ${extra}` : extra)

/**
 * The furthest-apart pair in a group, or nothing if they all agree.
 *
 * "Do any two of these disagree by more than a month" is decided entirely by the
 * extremes, so this is a single pass tracking min and max rather than a
 * comparison of every pair. The pairwise form is quadratic in a group with no
 * size limit — nothing caps how many `<meta article:published_time>` tags a page
 * may carry, and since an early exit can only fire on a *disagreement*, a page
 * repeating one date is its worst case rather than its cheapest. 3000 of them is
 * 183 KB of HTML and seconds of blocked event loop.
 *
 * Reporting the widest pair rather than the first-found one is also the better
 * answer: it names the two sources actually furthest apart.
 */
function widestDisagreement(
  candidates: Candidate[],
): { earliest: Candidate; latest: Candidate; gap: number } | null {
  let earliest: Candidate | undefined
  let latest: Candidate | undefined
  let min = Infinity
  let max = -Infinity

  // One parse per candidate. The pairwise form re-parses both values on every
  // comparison, which parses the same string O(n) times.
  for (const candidate of candidates) {
    const at = toInstant(candidate.value)
    if (!at) continue
    const ms = at.getTime()
    if (ms < min) {
      min = ms
      earliest = candidate
    }
    if (ms > max) {
      max = ms
      latest = candidate
    }
  }

  if (!earliest || !latest) return null
  const gap = (max - min) / DAY_MS
  return gap > DECLARED_DISAGREEMENT_DAYS ? { earliest, latest, gap } : null
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

  // Among publication dates the site declared *at the same strength*, the
  // earliest is the publication. A later one is a republication stamp — the same
  // reasoning the `predated-content` conflict already rests on.
  //
  // Source ranking alone gets this wrong systematically rather than
  // occasionally. Every El País article carries an `itemprop datepublished` of
  // the writing time and an `article:published_time` dated a day later, and
  // because OpenGraph outranks itemprop the wrong one won on every Spanish page
  // in the corpus.
  //
  // Restricted to the `declared` tier, and that restriction is the whole rule
  // rather than caution. A declared date is a document-level assertion: the page
  // states one `article:published_time`, one `datePublished`, and they are about
  // *this* document. Weaker sources repeat per element and describe other
  // documents freely — a `<time>` in byline markup appears once per item in a
  // related-articles rail, so "earliest" there means the oldest article in the
  // sidebar. Applied to the derived tier this rule cost 16 of 39 Japanese pages,
  // every one of them a 2009 sidebar entry beating the 2015 article.
  //
  // Two further guards: the candidate must be no coarser, so this never trades
  // "31 December 2024" for "December 2024"; and the gap must be under the
  // threshold at which the library already calls two declarations a
  // contradiction. Past that point this stops guessing and
  // `declared-disagreement` reports the disagreement instead.
  if (resolvedPublished?.confidence === 'declared') {
    const incumbent = resolvedPublished
    const limit = DECLARED_DISAGREEMENT_DAYS * DAY_MS
    resolvedPublished = published.reduce((bestSoFar, c) => {
      if (c.confidence !== 'declared') return bestSoFar
      if (PRECISION_RANK[c.precision] < PRECISION_RANK[incumbent.precision]) return bestSoFar
      const a = toInstant(c.value)
      const b = toInstant(bestSoFar.value)
      if (!a || !b || a >= b) return bestSoFar
      return b.getTime() - a.getTime() <= limit ? c : bestSoFar
    }, incumbent)
  }

  // An unlabelled date is more likely to be the publication date than the
  // modification date — sites that bother to distinguish usually label the edit.
  //
  // It is promoted when nothing claims the field, and also when it is simply
  // better evidence than what does: a date inside a container the site marked
  // as its date block outranks a month inferred from the URL, and refusing to
  // promote on the strength of a field label alone would keep the worse answer.
  const bestUnknown = best(unknown)
  const outranksPublished =
    bestUnknown !== undefined &&
    resolvedPublished !== undefined &&
    rank(bestUnknown) > rank(resolvedPublished) &&
    // Outranking has to mean *better evidence*, not merely a higher-ranked
    // source within the same tier. A field label is a claim the page made about
    // which date this is; an unlabelled candidate makes no claim at all, and
    // source rank is a tie-break between things of equal standing, not grounds
    // for overturning one.
    //
    // Horizont.net is the case: the article's own `<span
    // class="PublishDate_date">29. Januar 2019</span>` is read as a publication
    // date, and a `<time>` from a related-articles rail — unlabelled, but
    // `time-tag` sits three places above `marked-date` and carries a minute —
    // outranked it and moved the page ten months. Both are `derived`, so
    // nothing about the rail was better evidence; it merely sorted higher.
    //
    // A genuinely stronger tier still wins, which is the case the rule was
    // written for: a date in a container the site marked as its date block
    // (`derived`) should displace a month inferred from the URL (`inferred`).
    CONFIDENCE_RANK[bestUnknown.confidence] > CONFIDENCE_RANK[resolvedPublished.confidence] &&
    // Never trade precision for source rank. A month from a marked date block
    // outranks a day from the URL on tier alone, but "December 2024" is a worse
    // answer than "31 December 2024" and replacing one with the other loses
    // information the page actually gave us.
    PRECISION_RANK[bestUnknown.precision] >= PRECISION_RANK[resolvedPublished.precision]

  if ((!resolvedPublished || outranksPublished) && unknown.length > 0) {
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

  // Last, so it operates on whatever the ranking above settled on, and only ever
  // moves the day the answer is reported under — never which candidate won.
  if (resolvedPublished) {
    resolvedPublished = localise(resolvedPublished, usable) ?? resolvedPublished
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
    const widest = widestDisagreement(group.filter((c) => c.confidence === 'declared'))
    if (widest) {
      const { earliest, latest, gap } = widest
      return {
        kind: 'declared-disagreement',
        gapDays: Math.round(gap),
        earlier: { source: earliest.source, value: earliest.value },
        later: { source: latest.source, value: latest.value },
        detail: `${earliest.source} says ${earliest.value}, ${latest.source} says ${latest.value} for the same field.`,
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

        const declared = resolvedPublished.value.slice(0, 10)
        const oldestDay = oldest.value.slice(0, 10)

        return {
          kind: 'predated-content',
          gapDays: Math.round(gap),
          declared,
          olderCount: distinct.size,
          oldest: oldestDay,
          detail: `Declares ${declared}, but carries ${distinct.size} dated elements from before then, back to ${oldestDay}. The declared date is likely a republication, not when this was written.`,
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
        const archived = archiveLastEdit.slice(0, 10)

        return {
          kind: 'stale-declaration',
          gapDays: Math.round(gap),
          declared: resolvedPublished.value,
          archived,
          detail: `Page declares ${resolvedPublished.value} and shows no update, but the archive records a change on ${archived}.`,
        }
      }
    }
  }

  return undefined
}
