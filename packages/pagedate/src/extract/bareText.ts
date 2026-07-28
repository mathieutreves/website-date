import type { Candidate } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'
import { foldCase } from '../parse/locale.js'
import { marksPageRegion, scoreContext } from './context.js'
import { collapse, DATE_ANYWHERE, directText, isBorrowedContent, MAYBE_DATE, textCandidates, NOT_A_DATE } from './patterns.js'

/**
 * Dates in rendered text with no label attached — a bare "December 11, 2023"
 * sitting under the headline.
 *
 * This is the single largest coverage gap: on htmldate's evaluation subset,
 * most pages carry their date exactly this way and the labelled extractor is
 * blind to all of them. It is also the noisiest possible signal, so precision
 * comes from *where* the text sits rather than from what it says.
 *
 * Guards, in order of importance:
 *  - quoted and code content is skipped, as are off-site link texts, because
 *    those dates belong to someone else's document
 *  - the element's own text must be mostly the date, unless it sits in markup
 *    explicitly marked as byline or date furniture
 *  - the field is left `unknown`: there is no label, so claiming "published"
 *    would be asserting something the page never said
 */

/** Bylines are short. Longer text is prose that happens to mention a date. */
const MAX_TEXT_LENGTH = 120

/** Fraction of the element's text the date must occupy in weak contexts. */
const MIN_DATE_RATIO = 0.45

/** Text this short is a date and nothing else, whatever the ratio says. */
const ALWAYS_ACCEPT_LENGTH = 32

/** More than this and we are reading a listing page, not a byline. */
const MAX_CANDIDATES = 6

export function extractBareText(
  doc: Document,
  pageUrl: URL | null,
  opts: ParseOptions = {},
): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  const pageHost = pageUrl?.hostname ?? null

  for (const el of textCandidates(doc)) {
    if (out.length >= MAX_CANDIDATES) break

    // Same cheap rejection as visibleText, before any allocation.
    const raw = dateBearingText(el)
    if (!raw || !MAYBE_DATE.test(raw)) continue
    // Prices, versions, phone numbers and IBANs all look like dates.
    if (NOT_A_DATE.test(raw)) continue

    const collapsed = collapse(raw)
    if (collapsed.length > MAX_TEXT_LENGTH) continue

    const text = foldCase(collapsed)
    const match = DATE_ANYWHERE.exec(text)
    if (!match) continue

    const context = scoreContext(el)
    if (!context.usable) continue
    if (isBorrowedContent(el, pageHost)) continue

    // In byline-marked markup the surrounding words are expected ("by Dan ·
    // 5 min read"); elsewhere the date has to carry the element.
    //
    // Page-region markers do not earn the exemption — see {@link marksPageRegion}
    // for what a footer costs. Narrowing further, to markers that positively
    // name a date block, was measured and refused: it also discards genuine
    // bylines marked only `entry-meta` or `author`, which is two real pages lost
    // against one artifact suppressed.
    const ratio = match[0].length / measurableLength(text)
    const bylineMarked = context.strong && !marksPageRegion(context.marker)
    if (!bylineMarked && text.length > ALWAYS_ACCEPT_LENGTH && ratio < MIN_DATE_RATIO) continue

    const parsed = parseDateString(match[0], opts)
    if (!parsed) continue
    if (seen.has(parsed.value)) continue
    seen.add(parsed.value)

    out.push({
      ...parsed,
      // Deliberately unlabelled — see the note above.
      field: 'unknown',
      source: 'text-date',
      confidence: 'inferred',
      note: bylineMarked
        ? `unlabelled date in byline markup: "${match[0].trim()}"`
        : `unlabelled date in text: "${match[0].trim()}"`,
    })
  }

  return out
}

/**
 * Weekday names and clock times, which pad a date line without adding meaning.
 *
 * German date blocks read "Mittwoch, 20. Februar 2019, 14:45 Uhr" — mostly
 * furniture around a date. Discounting it stops the ratio guard from rejecting
 * a line that is, in substance, entirely a date.
 */
const PADDING =
  /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b|\b\d{1,2}[:.]\d{2}\s*(uhr|am|pm|h)?\b|\bum\b|\bbis\b/gi

/** Length of the text once weekday and clock padding is discounted. */
function measurableLength(text: string): number {
  return Math.max(1, text.replace(PADDING, '').replace(/\s+/g, ' ').trim().length)
}

/**
 * The element's own text, plus `title` where markup convention puts the real
 * date there.
 *
 * hAtom writes `<abbr class="published" title="...">`, and Facebook renders
 * `<abbr title="Freitag, 6. Oktober 2017 um 04:00">` with only a relative
 * "3 hrs" as the visible text — so reading text alone finds nothing.
 */
function dateBearingText(el: Element): string {
  const own = directText(el)
  const tag = el.tagName?.toUpperCase()

  if (tag === 'ABBR' || tag === 'TIME' || tag === 'SPAN') {
    const title = el.getAttribute('title')
    if (title && DATE_ANYWHERE.test(title)) return title
  }

  return own
}

