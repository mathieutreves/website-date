import type { Candidate } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'
import { foldCase } from '../parse/locale.js'
import { scoreContext } from './context.js'
import { MODIFIED_LABEL_PATTERN, PUBLISHED_LABEL_PATTERN } from './labels.js'
import { DATE_BODY, isBorrowedContent, TEXT_CANDIDATE_SELECTOR } from './patterns.js'

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
    // Folded, because both the label and month-name patterns are built from
    // diacritic-stripped keys — see parse/locale.ts.
    const text = foldCase(directText(el))
    if (!text || text.length > MAX_TEXT_LENGTH) continue

    const context = scoreContext(el)
    if (!context.usable) continue
    if (isBorrowedContent(el, pageHost)) continue

    for (const [regex, field] of [
      [MODIFIED_RE, 'modified'],
      [PUBLISHED_RE, 'published'],
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
    if (node.nodeType === 3) out += node.nodeValue ?? ''
    else if (node.nodeType === 1) {
      const tag = (node as Element).tagName?.toUpperCase()
      // Inline wrappers are part of the same phrase.
      if (tag === 'TIME' || tag === 'SPAN' || tag === 'B' || tag === 'STRONG' || tag === 'EM') {
        out += (node as Element).textContent ?? ''
      }
    }
  }
  return out.replace(/\s+/g, ' ').trim()
}
