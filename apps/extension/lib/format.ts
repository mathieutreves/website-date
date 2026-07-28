import { toInstant, type Candidate } from 'pagedate'
import { t, type MessageKey } from './messages.js'

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
  'visible-text': 'srcVisibleText',
  'text-date': 'srcTextDate',
  'http-last-modified': 'srcHttpLastModified',
}

export const sourceLabel = (source: string): string => {
  const key = SOURCE_KEYS[source]
  return key ? t(key) : source.replace(/[-_]/g, ' ')
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
 */
export function display(candidate: Candidate): string {
  const value = candidate.value

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
