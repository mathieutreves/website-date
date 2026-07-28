import type { Candidate } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'
import { foldCase } from '../parse/locale.js'
import { scoreContext } from './context.js'
import { DATE_ANYWHERE, isBorrowedContent, TEXT_CANDIDATE_SELECTOR } from './patterns.js'

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

  for (const el of doc.querySelectorAll(TEXT_CANDIDATE_SELECTOR)) {
    if (out.length >= MAX_CANDIDATES) break

    const text = foldCase(directText(el))
    if (!text || text.length > MAX_TEXT_LENGTH) continue

    const match = DATE_ANYWHERE.exec(text)
    if (!match) continue

    const context = scoreContext(el)
    if (!context.usable) continue
    if (isBorrowedContent(el, pageHost)) continue

    // In byline-marked markup the surrounding words are expected ("by Dan ·
    // 5 min read"); elsewhere the date has to carry the element.
    const ratio = match[0].length / text.length
    if (!context.strong && text.length > ALWAYS_ACCEPT_LENGTH && ratio < MIN_DATE_RATIO) continue

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
      note: context.strong
        ? `unlabelled date in byline markup: "${match[0].trim()}"`
        : `unlabelled date in text: "${match[0].trim()}"`,
    })
  }

  return out
}

/**
 * Text belonging to this element rather than its descendants, so a wrapper
 * doesn't inherit every date its children contain.
 */
function directText(el: Element): string {
  let out = ''
  for (const node of el.childNodes) {
    // Node.TEXT_NODE === 3 / ELEMENT_NODE === 1; compared numerically because
    // the Node constants are not globals under linkedom.
    if (node.nodeType === 3) out += node.nodeValue ?? ''
    else if (node.nodeType === 1) {
      const tag = (node as Element).tagName?.toUpperCase()
      if (tag === 'TIME' || tag === 'SPAN' || tag === 'B' || tag === 'STRONG' || tag === 'EM') {
        out += (node as Element).textContent ?? ''
      }
    }
  }
  return out.replace(/\s+/g, ' ').trim()
}
