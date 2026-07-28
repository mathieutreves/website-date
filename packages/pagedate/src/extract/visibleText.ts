import type { Candidate } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'
import { foldCase } from '../parse/locale.js'
import { fieldFromMarker, marksDateBlock, scoreContext } from './context.js'
import { MODIFIED_LABEL_PATTERN, PUBLISHED_LABEL_PATTERN } from './labels.js'
import { DATE_ANYWHERE, DATE_BODY, isBorrowedContent, MAYBE_DATE, TEXT_CANDIDATE_SELECTOR, NOT_A_DATE } from './patterns.js'

/**
 * Prose like "Last updated on 3 March 2024".
 *
 * The weakest generic signal, and the only one that reads rendered text, so it
 * is deliberately anchored: a date is only taken when it directly follows a
 * recognised label. Scanning for bare dates anywhere in the body produces far
 * more noise than signal.
 */

/**
 * Separator between the label and the date: "updated: 3 March", "updated on
 * 3 March", "公開日：2024年3月12日".
 *
 * Includes the full-width colon and ideographic space, without which every CJK
 * label sits flush against its date and never matches.
 */
const GAP = `[\\s:：、,，—–\\-]{0,4}(?:on|il|am|le|el|em|op|the|v|dnia)?[\\s:：、,，—–\\-]{0,4}`

const MODIFIED_RE = new RegExp(`(?:${MODIFIED_LABEL_PATTERN})${GAP}(${DATE_BODY})`, 'i')
const PUBLISHED_RE = new RegExp(`(?:${PUBLISHED_LABEL_PATTERN})${GAP}(${DATE_BODY})`, 'i')

/**
 * The same phrases with the date *before* the label.
 *
 * German puts the participle last — "Dieser Artikel wurde am 14. Dezember 2015
 * um 14:48 veröffentlicht" — and Dutch, Polish and Turkish do much the same.
 * Matching only label-then-date is blind to all of them.
 *
 * The window between the two is deliberately short: a date and a label at
 * opposite ends of a paragraph are not describing each other.
 */
const TRAILING_GAP = `[^<>]{0,48}?`
const MODIFIED_AFTER_RE = new RegExp(
  `(${DATE_BODY})${TRAILING_GAP}(?:${MODIFIED_LABEL_PATTERN})`,
  'i',
)
const PUBLISHED_AFTER_RE = new RegExp(
  `(${DATE_BODY})${TRAILING_GAP}(?:${PUBLISHED_LABEL_PATTERN})`,
  'i',
)


/** Long blocks are article prose, not a byline. */
const MAX_TEXT_LENGTH = 220

export function extractVisibleText(
  doc: Document,
  pageUrl: URL | null,
  opts: ParseOptions = {},
): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  const pageHost = pageUrl?.hostname ?? null

  for (const el of doc.querySelectorAll(TEXT_CANDIDATE_SELECTOR)) {
    // Only look at elements whose own text is short — a <div> wrapping the
    // whole article would otherwise match its first byline over and over.
    // Reject before any string work. Collapsing whitespace allocates, folding
    // is up to two Unicode normalisation passes, and the label patterns are
    // large alternations — almost every element on a page has no year in it and
    // can skip all three.
    const raw = directText(el)
    if (!raw || !MAYBE_DATE.test(raw)) continue
    // Prices, versions, phone numbers and IBANs all look like dates.
    if (NOT_A_DATE.test(raw)) continue

    const collapsed = collapse(raw)
    if (collapsed.length > MAX_TEXT_LENGTH) continue

    // Folded, because both the label and month-name patterns are built from
    // diacritic-stripped keys — see parse/locale.ts.
    const text = foldCase(collapsed)

    const context = scoreContext(el)
    if (!context.usable) continue
    if (isBorrowedContent(el, pageHost)) continue

    // Markup can label a date as clearly as words can. A bare date inside a
    // container the site named `PublishDate_date` or `entry-date` is a stated
    // publication date, and reading it as one keeps it from being left
    // unlabelled and outranked by a worse candidate elsewhere on the page.
    // A generic marker — `date`, `datum`, `time`, `meta` — says a date lives
    // here without saying which kind. That is still worth far more than
    // guessing from prose, so it yields an `unknown` candidate at derived
    // confidence rather than nothing: `<span class="press_location_time">
    // Schengen, 3. Juli 2018</span>` is plainly the article's date block.
    const markerField = fieldFromMarker(context.marker)
    if (marksDateBlock(context.marker) && !MODIFIED_RE.test(text) && !PUBLISHED_RE.test(text)) {
      // hAtom writes `<abbr class="published" title="2016-12-23T05:11:00-05:00">
      // 5:11 AM</abbr>` — the marker names it a publication date and the machine
      // value is in the attribute, while the text alone says only a time.
      const title = el.getAttribute('title')
      const source = DATE_ANYWHERE.test(text) ? text : title && MAYBE_DATE.test(title) ? title : text

      const match = DATE_ANYWHERE.exec(source)
      const parsed = match ? parseDateString(match[0], opts) : null
      if (parsed && !seen.has(`${markerField}:${parsed.value}`)) {
        seen.add(`${markerField}:${parsed.value}`)
        out.push({
          ...parsed,
          field: markerField,
          source: 'marked-date',
          // Derived, not inferred: this comes from markup the site authored,
          // not from guessing at prose.
          confidence: 'derived',
          note: `date in markup marked "${context.marker}"`,
        })
        continue
      }
    }

    for (const [regex, field] of [
      [MODIFIED_RE, 'modified'],
      [PUBLISHED_RE, 'published'],
      [MODIFIED_AFTER_RE, 'modified'],
      [PUBLISHED_AFTER_RE, 'published'],
    ] as const) {
      const match = regex.exec(text)
      if (!match?.[1]) continue

      const parsed = parseDateString(match[1], opts)
      if (!parsed) continue

      const key = `${field}:${parsed.value}`
      if (seen.has(key)) continue
      seen.add(key)

      out.push({
        ...parsed,
        field,
        source: 'visible-text',
        confidence: 'inferred',
        note: `text: "${match[0].trim().slice(0, 60)}"`,
      })
    }
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
    // Node.TEXT_NODE === 3; comparing numerically keeps this working under
    // linkedom, where the Node constants aren't globals.
    // `textContent` is the fallback because some non-browser DOM
    // implementations (node-html-parser) leave `nodeValue` undefined on text
    // nodes. On a text node the two are defined to be equal, so this costs
    // nothing on a real DOM and keeps the extractor parser-agnostic.
    if (node.nodeType === 3) out += node.nodeValue ?? node.textContent ?? ''
    else if (node.nodeType === 1) {
      const tag = (node as Element).tagName?.toUpperCase()
      // Inline wrappers are part of the same phrase.
      if (tag === 'TIME' || tag === 'SPAN' || tag === 'B' || tag === 'STRONG' || tag === 'EM') {
        out += (node as Element).textContent ?? ''
      }
    }
  }
  return out
}

/** Whitespace collapsing, deferred until an element is known to be worth it. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
