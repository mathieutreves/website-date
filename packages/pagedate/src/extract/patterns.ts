import { CJK_DATE_PATTERN, MONTH_NAME_PATTERN } from '../parse/locale.js'

/**
 * Date shapes recognisable in rendered text, in any supported language.
 *
 * Shared by the labelled and unlabelled text extractors so the two can never
 * drift apart on what counts as a date.
 */
export const DATE_BODY = [
  // CJK first: `2024年3月12日` has no separators the Latin patterns would find.
  CJK_DATE_PATTERN,
  // "12 March 2024", "12 de marzo de 2024", "19. Juli 2014", "12 марта 2024"
  `\\d{1,2}\\.?\\s+(?:de\\s+)?(?:${MONTH_NAME_PATTERN})\\.?\\s+(?:de\\s+|del\\s+|r\\.?\\s*)?\\d{4}`,
  // "March 12, 2024"
  `(?:${MONTH_NAME_PATTERN})\\.?\\s+\\d{1,2},?\\s+\\d{4}`,
  // "March 2024"
  `(?:${MONTH_NAME_PATTERN})\\.?\\s+\\d{4}`,
  // ISO
  `\\d{4}-\\d{2}-\\d{2}`,
  // "12/03/2024", "19.07.2014", "12-03-2024"
  `\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{4}`,
].join('|')

/** Anywhere-in-string matcher, for finding a date inside a longer phrase. */
export const DATE_ANYWHERE = new RegExp(DATE_BODY, 'i')

/**
 * Elements whose text is worth scanning for a date.
 *
 * `abbr` earns its place: the hAtom microformat convention is
 * `<abbr class="published" title="...">16.12.2012</abbr>`, still common on
 * older German and WordPress blogs, and omitting it loses those pages outright.
 * `a` is included because permalink-as-date is a widespread byline pattern —
 * off-site links are filtered separately by {@link isBorrowedContent}.
 */
export const TEXT_CANDIDATE_SELECTOR =
  'p, span, div, li, small, em, strong, b, i, time, abbr, address, figcaption, td, dd, label, a, h1, h2, h3, h4, h5, h6'

/**
 * Containers whose text is quotation or code rather than the page's own voice.
 * A date inside one of these belongs to someone else's document.
 */
export const QUOTED_TAGS = new Set(['BLOCKQUOTE', 'CODE', 'PRE', 'SAMP', 'KBD'])

/**
 * True when the element sits inside quoted or code content, or inside a link
 * pointing at another site.
 *
 * Both cases produce dates that belong to a different document — a blog that
 * cites "January 28, 2013" from a linked tweet is not itself from 2013.
 */
export function isBorrowedContent(el: Element, pageHost: string | null): boolean {
  let node: Element | null = el
  let depth = 0

  while (node && depth < 16) {
    const tag = node.tagName?.toUpperCase()
    if (tag && QUOTED_TAGS.has(tag)) return true

    if (tag === 'A' && pageHost) {
      const href = node.getAttribute('href')
      if (href && /^https?:\/\//i.test(href)) {
        try {
          if (new URL(href).hostname !== pageHost) return true
        } catch {
          // unparseable href — treat as local
        }
      }
    }

    node = node.parentElement
    depth++
  }

  return false
}
