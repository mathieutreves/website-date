import { toInstant, type Candidate, type DateResult } from 'pagedate'
import { t, type MessageKey } from './messages.js'
import type { DateFormat } from './settings.js'

/**
 * Turning a candidate into words. Pure, and shared by all three surfaces —
 * the popup, the on-page overlay, and the toolbar badge — so a date can never
 * read one way in the panel and another way in the corner of the page.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export const tierWord = (confidence: Candidate['confidence']): string =>
  t(
    ({ declared: 'tierDeclared', derived: 'tierDerived', inferred: 'tierInferred' } as const)[
      confidence
    ],
  )

/**
 * Extractor ids are internal identifiers, not English.
 *
 * `atom-feed` and `parsely` mean nothing to a reader deciding whether to trust
 * a date, and a UI that shows its own internals is asking the reader to do the
 * interpreting.
 */
const SOURCE_KEYS: Record<string, MessageKey> = {
  adapter: 'srcAdapter',
  jsonld: 'srcJsonld',
  'jsonld-container': 'srcJsonldContainer',
  'atom-feed': 'srcAtomFeed',
  'rss-feed': 'srcRssFeed',
  opengraph: 'srcOpengraph',
  itemprop: 'srcItemprop',
  'dublin-core': 'srcDublinCore',
  citation: 'srcCitation',
  parsely: 'srcParsely',
  sailthru: 'srcSailthru',
  'time-tag': 'srcTimeTag',
  sitemap: 'srcSitemap',
  'meta-date': 'srcMetaDate',
  'url-slug': 'srcUrlSlug',
  'image-path': 'srcImagePath',
  'visible-text': 'srcVisibleText',
  'text-date': 'srcTextDate',
  'http-last-modified': 'srcHttpLastModified',
}

export const sourceLabel = (source: string): string => {
  const key = SOURCE_KEYS[source]
  return key ? t(key) : source.replace(/[-_]/g, ' ')
}

export type ConflictKind = NonNullable<DateResult['conflict']>['kind']

/**
 * What a contradiction is called, and how loudly to say it.
 *
 * Three surfaces show this — the popup's warning block, the on-page readout and
 * the badge tooltip — and all three read the mapping from here. Three copies of
 * a table with three rows is where a fourth kind gets added to two of them.
 *
 * Only two of the three are loud. `stale-declaration` is informational: the date
 * shown is real, there is just more to the story. Giving all three the same red
 * treatment would make the flag constant, and a constant flag is furniture.
 */
const CONFLICTS = {
  'declared-disagreement': { key: 'conflictDisagreement', tone: 'alert' },
  'predated-content': { key: 'conflictPredated', tone: 'alert' },
  'stale-declaration': { key: 'conflictStale', tone: 'notice' },
} as const satisfies Record<ConflictKind, { key: MessageKey; tone: 'alert' | 'notice' }>

export const conflictHeading = (kind: ConflictKind): string => t(CONFLICTS[kind].key)

export const conflictTone = (kind: ConflictKind): 'alert' | 'notice' => CONFLICTS[kind].tone

/**
 * The sentence under the heading.
 *
 * `conflict.detail` says the same thing and is right there, which is exactly
 * why this exists: it is English in every locale, and rendering it underneath a
 * translated heading gives a warning that switches language halfway through.
 * The library carries the facts alongside the prose, so the sentence is rebuilt
 * here from those instead of being taken ready-made.
 *
 * Sources go through {@link sourceLabel} on the way, which the library's own
 * version cannot do: it only has extractor ids, so its English reads
 * "opengraph says …" where this reads "an OpenGraph tag says …".
 */
export function conflictDetail(conflict: NonNullable<DateResult['conflict']>): string {
  switch (conflict.kind) {
    case 'declared-disagreement':
      return t(
        'conflictDisagreementDetail',
        sourceLabel(conflict.earlier.source),
        conflict.earlier.value,
        sourceLabel(conflict.later.source),
        conflict.later.value,
      )
    case 'predated-content':
      return t(
        'conflictPredatedDetail',
        conflict.declared,
        String(conflict.olderCount),
        conflict.oldest,
      )
    case 'stale-declaration':
      return t('conflictStaleDetail', conflict.declared, conflict.archived)
  }
}

/** Same reasoning as {@link sourceLabel}: `unknown` is a type name, not a word. */
export const fieldLabel = (field: Candidate['field']): string =>
  t(
    ({
      published: 'candidateFieldPublished',
      modified: 'candidateFieldModified',
      unknown: 'candidateFieldUnknown',
    } as const)[field],
  )

/**
 * "About 3 years ago" — the headline, and the only line most readers need.
 *
 * An absolute date makes you do subtraction before you know whether to keep
 * reading. Precision is respected here too: a source that only said "2024"
 * cannot support "3 years ago" to the day, so it is hedged.
 */
export function relativeAge(candidate: Candidate, now: Date): string | null {
  const at = toInstant(candidate.value)
  if (!at) return null

  const days = (now.getTime() - at.getTime()) / DAY_MS
  if (days < -1) return t('ageFuture')

  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  let phrase: string
  if (days < 1) phrase = relative.format(0, 'day')
  else if (days < 45) phrase = relative.format(-Math.round(days), 'day')
  else if (days < 550) phrase = relative.format(-Math.round(days / 30.44), 'month')
  else phrase = relative.format(-Math.round(days / 365.25), 'year')

  // A vague source cannot carry an exact age. Same rule as `display`, applied
  // to the arithmetic rather than the formatting.
  const vague = candidate.precision === 'year' || candidate.precision === 'month'
  return vague && days >= 45 ? t('ageApprox', phrase) : phrase
}

/**
 * Format to the precision the source actually carried.
 *
 * A year-precision candidate renders as "2024", never as "1 January 2024" —
 * inventing a day the page never stated is the same dishonesty the library
 * refuses at the parse layer. The rule cuts both ways: a `minute` candidate
 * keeps its clock time rather than being flattened to a bare day.
 *
 * `iso` short-circuits the locale formatting entirely. The candidate's value is
 * already ISO 8601 truncated to its precision, so honesty about precision comes
 * for free: a month-precision candidate is `2024-03`, never `2024-03-01`.
 */
export function display(candidate: Candidate, format: DateFormat = 'absolute'): string {
  const value = candidate.value

  if (format === 'iso') return value

  if (candidate.precision === 'year') return value

  if (candidate.precision === 'month') {
    const date = new Date(`${value}-01T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' })
  }

  if (candidate.precision === 'day') {
    const date = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    })
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
