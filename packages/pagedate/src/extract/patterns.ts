import { CJK_DATE_PATTERN, MONTH_NAME_PATTERN, ORDINAL_SUFFIX } from '../parse/locale.js'

/**
 * Date shapes recognisable in rendered text, in any supported language.
 *
 * Shared by the labelled and unlabelled text extractors so the two can never
 * drift apart on what counts as a date.
 */
export const DATE_BODY = [
  // CJK first: `2024年3月12日` has no separators the Latin patterns would find.
  CJK_DATE_PATTERN,
  // "12 March 2024", "12 de marzo de 2024", "19. Juli 2014", "12 марта 2024",
  // "le 1er mars 2013"
  `\\d{1,2}${ORDINAL_SUFFIX}\\.?\\s+(?:de\\s+)?(?:${MONTH_NAME_PATTERN})\\.?\\s+(?:de\\s+|del\\s+|r\\.?\\s*)?\\d{4}`,
  // "March 12, 2024", "November 1st, 2012"
  `(?:${MONTH_NAME_PATTERN})\\.?\\s+\\d{1,2}${ORDINAL_SUFFIX},?\\s+\\d{4}`,
  // "March 2024"
  `(?:${MONTH_NAME_PATTERN})\\.?\\s+\\d{4}`,
  // ISO
  `\\d{4}-\\d{2}-\\d{2}`,
  // Year-first with a separator other than the ISO hyphen: "2015.4.23",
  // "2024/03/12". This is the ordinary written form in Japan, China, Korea and
  // Hungary, and its absence was not a rounding error — every Japanese page in
  // the corpus whose date is written this way returned *no candidates at all*,
  // because nothing else on those pages carries a date either. The leading
  // four-digit year makes it unambiguous, so unlike the day-first form below it
  // needs no locale guess.
  `\\d{4}[/.]\\d{1,2}[/.]\\d{1,2}`,
  // "12/03/2024", "19.07.2014", "12-03-2024"
  `\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{4}`,
].join('|')

/** Anywhere-in-string matcher, for finding a date inside a longer phrase. */
export const DATE_ANYWHERE = new RegExp(DATE_BODY, 'i')

/**
 * Cheap rejection test, run before any expensive work.
 *
 * Every date form supported here contains a four-digit year or a CJK year
 * marker, so text failing this cannot contain a date. The overwhelming majority
 * of elements on a page fail it, which lets them skip a Unicode normalisation
 * and two large regex alternations each — the single biggest cost in
 * extraction. Digit ranges cover the non-ASCII numeral systems the parser
 * normalises later.
 */
export const MAYBE_DATE =
  /[0-9٠-٩۰-۹०-९๐-๙０-９]{4}|[年년]/

/**
 * Text that contains digits in a date-like shape but is not a date.
 *
 * Version numbers, prices, phone numbers, postal codes, IP addresses and bank
 * details all read as `12.03.2024` to a naive matcher. Rejecting them is pure
 * precision: nothing here can ever be a publication date.
 *
 * Adapted from htmldate's DISCARD_PATTERNS (Apache-2.0), which arrived at much
 * the same list from the same corpus.
 */
export const NOT_A_DATE = new RegExp(
  [
    '^\\d{1,2}:\\d{2}(?:[ :]|$)', // a clock time alone
    '[$€¥£¢₽₱฿₹#]', // currency symbols
    '\\b[A-Z]{3}\\d', // currency codes like USD1
    '(?:^|\\D)(?:\\+\\d{2}|\\d{5,})\\D', // phone numbers, postal codes
    '\\b(?:ftps?|https?|sftp)://', // URLs
    '\\bIBAN\\b|\\b[A-Z]{2}\\d{2}[A-Z0-9]{10,}', // bank accounts
    // Version numbers must carry the `v` prefix or a fourth component. A bare
    // `16.12.2012` is a German date, and matching that shape as a version
    // silently discards the single most common European date format.
    '\\bv\\d+\\.\\d+(?:\\.\\d+)?\\b|\\b\\d+\\.\\d+\\.\\d+\\.\\d+\\b',
    '®|™', // trademark noise
  ].join('|'),
)

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

/** The same list as a set, for {@link textCandidates}. */
const TEXT_CANDIDATE_TAGS = new Set(
  TEXT_CANDIDATE_SELECTOR.split(',').map((tag) => tag.trim().toUpperCase()),
)

/**
 * Every element worth scanning for a date, in document order.
 *
 * A hand-written walk rather than `querySelectorAll(TEXT_CANDIDATE_SELECTOR)`,
 * because node-html-parser's selector engine is quadratic in the number of
 * elements and this is the largest selector the library runs. Measured on a flat
 * document of `<p>` siblings:
 *
 *     4,000 elements     48 ms
 *     8,000 elements    205 ms
 *    16,000 elements  1,752 ms
 *    32,000 elements 12,146 ms
 *
 * — and the extractors run it twice per document. 32,000 sibling paragraphs is
 * around 2 MB of HTML, so that is a cheap request costing twelve seconds of
 * blocked event loop, which is worse than anything in the library's own code.
 *
 * The selector is a plain list of tag names with no combinators, so one
 * pre-order traversal collecting matching tags is exactly equivalent — same
 * elements, same order — and linear. A browser's native `querySelectorAll` is
 * already linear, so this costs the extension nothing; it is the Node parser
 * that needed it.
 */
export function textCandidates(doc: Document): Element[] {
  const root = rootElement(doc) ?? (doc as unknown as Element)
  const out: Element[] = []
  const stack: Array<[ArrayLike<ChildNode>, number]> = [[root.childNodes, 0]]

  // Same cursor-stack shape as `boundedText`, and for the same reason: pushing
  // every child of a wide node up front would reintroduce the cost being fixed.
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!
    const [children, index] = frame
    if (index >= children.length) {
      stack.pop()
      continue
    }
    frame[1] = index + 1

    const node = children[index]!
    if (node.nodeType !== 1) continue
    const el = node as Element
    if (TEXT_CANDIDATE_TAGS.has(el.tagName?.toUpperCase() ?? '')) out.push(el)
    stack.push([el.childNodes, 0])
  }

  if (TEXT_CANDIDATE_TAGS.has(root.tagName?.toUpperCase() ?? '')) out.unshift(root)
  return out
}

/**
 * Containers whose text is quotation or code rather than the page's own voice.
 * A date inside one of these belongs to someone else's document.
 */
export const QUOTED_TAGS = new Set(['BLOCKQUOTE', 'CODE', 'PRE', 'SAMP', 'KBD'])

/**
 * The element a node hangs from, for implementations that ship `parentNode` but
 * not `parentElement`.
 *
 * Not a hypothetical: node-html-parser omits `parentElement` entirely, and an
 * ancestor walk written against it there stops at depth 0 — silently, returning
 * a usable-looking score that has consulted nothing. That failure is invisible
 * on any page whose date comes from metadata, which is most of them, so it does
 * not show up as a wrong answer until it does.
 */
export function parentOf(el: Element): Element | null {
  const direct = el.parentElement
  if (direct) return direct
  // Node.ELEMENT_NODE === 1, compared numerically — see directText below.
  const node = el.parentNode
  return node && node.nodeType === 1 ? (node as Element) : null
}

/** The root element, for implementations that omit `documentElement`. */
export const rootElement = (doc: Document): Element | null =>
  doc.documentElement ?? doc.querySelector('html')

/**
 * The source text of a `<script>`, with character references left alone.
 *
 * `<script>` is a raw-text element: the HTML spec says its contents are *not*
 * entity-decoded, so `textContent` is the source verbatim. node-html-parser
 * decodes them anyway, which turns any JSON-LD block containing `&quot;` — a
 * headline with a quoted phrase in it, which is common — into invalid JSON. The
 * failure is not a wrong date but a silent one: `JSON.parse` throws, the whole
 * block is skipped as malformed, and the page falls through to whatever weaker
 * signal it has. JSON-LD is the strongest signal there is, so reading it through
 * `textContent` loses the most reliable answer on exactly the pages that have
 * one.
 *
 * `innerHTML` is the fallback rather than node-html-parser's `rawText` because
 * it is standard DOM: on a real `<script>` element the two are identical, so
 * this costs a browser nothing and keeps the shim parser-agnostic.
 */
export function scriptSource(script: Element): string {
  const text = script.textContent ?? ''
  const raw = script.innerHTML
  // Only prefer innerHTML where it actually differs — i.e. where a parser has
  // decoded something it should not have.
  return typeof raw === 'string' && raw.length > text.length ? raw : text
}

/** Wrappers that are part of the same phrase rather than a nested block. */
const INLINE_TAGS = new Set(['TIME', 'SPAN', 'B', 'STRONG', 'EM'])

/**
 * Text belonging to this element rather than its descendants, so a wrapper
 * doesn't inherit every date its children contain.
 *
 * Shared by both text extractors, which ran identical copies of this and would
 * otherwise drift apart on what counts as an element's own text.
 *
 * Iterates `childNodes` rather than walking `firstChild`/`nextSibling`. The
 * sibling walk is roughly twice as fast under linkedom, which materialises
 * `childNodes` as a fresh array on each access — but node-html-parser populates
 * `childNodes` while leaving `nextSibling` pointing nowhere, so the walk reads
 * only the first child and silently truncates every element's text. `childNodes`
 * is the form every implementation agrees on, and the difference it costs is
 * a fraction of what a faster parser saves.
 */
export function directText(el: Element): string {
  let out = ''
  // Node.TEXT_NODE === 3 / ELEMENT_NODE === 1; compared numerically because the
  // Node constants are not globals under linkedom.
  for (const node of el.childNodes) {
    // `textContent` is the fallback because some non-browser DOM
    // implementations (node-html-parser) leave `nodeValue` undefined on text
    // nodes. On a text node the two are defined to be equal, so this costs
    // nothing on a real DOM and keeps the extractor parser-agnostic.
    if (node.nodeType === 3) out += node.nodeValue ?? node.textContent ?? ''
    else if (node.nodeType === 1) {
      const tag = (node as Element).tagName?.toUpperCase()
      if (tag && INLINE_TAGS.has(tag)) out += (node as Element).textContent ?? ''
    }
  }
  return out
}

/**
 * An element's text, stopping once `limit` characters have been gathered.
 *
 * `textContent` is the obvious way to write this and the wrong one wherever a
 * bounded amount of text is wanted, because it materialises the entire subtree
 * before anything can be sliced off it. Callers that read a few hundred
 * characters near an element then pay for the whole document — and on a page
 * with many such elements they pay for it once each, which is quadratic in a
 * quantity the page controls. 4000 `<time>` tags beside a megabyte of filler is
 * 1.1 MB of HTML and, done that way, thirteen seconds.
 *
 * Descends depth-first in document order so the prefix returned is the same
 * prefix `textContent` would have produced, and carries a node budget as well as
 * a character one: a deep subtree of empty elements yields no text but can still
 * cost an unbounded walk.
 *
 * The stack holds a cursor per level rather than the pending children
 * themselves. Pushing every child of a node up front is the obvious way to write
 * an iterative walk and reintroduces exactly the bug this function exists to
 * fix: `<body>` on the page above has 18,000 children, so an eager push costs
 * 18,000 operations to read the first 400 characters, once per call. Advancing
 * an index means the walk pays only for the nodes it actually looks at.
 */
export function boundedText(el: Element, limit: number): string {
  const parts: string[] = []
  let length = 0
  let visits = MAX_TEXT_NODE_VISITS

  // Each frame is [children of some element, index of the next one to visit].
  const stack: Array<[ArrayLike<ChildNode>, number]> = [[el.childNodes, 0]]

  while (stack.length > 0 && length < limit && visits-- > 0) {
    const frame = stack[stack.length - 1]!
    const [children, index] = frame

    if (index >= children.length) {
      stack.pop()
      continue
    }
    frame[1] = index + 1

    const node = children[index]!
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? node.textContent ?? ''
      parts.push(text)
      length += text.length
    } else if (node.nodeType === 1) {
      stack.push([(node as Element).childNodes, 0])
    }
  }

  return parts.join('').slice(0, limit)
}

/** Companion bound to {@link boundedText}'s character limit, for text-sparse subtrees. */
const MAX_TEXT_NODE_VISITS = 4_000

/** Whitespace collapsing, deferred until an element is known to be worth it. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

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

    node = parentOf(node)
    depth++
  }

  return false
}
