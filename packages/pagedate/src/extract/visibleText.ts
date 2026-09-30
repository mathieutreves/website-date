import type { Candidate } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'
import { foldCase } from '../parse/locale.js'
import { fieldFromMarker, marksDateBlock, scoreContext } from './context.js'
import {
  fieldFromStandaloneLabel,
  MODIFIED_LABEL_PATTERN,
  PUBLISHED_LABEL_PATTERN,
} from './labels.js'
import { collapse, DATE_ANYWHERE, DATE_BODY, directText, isBorrowedContent, MAYBE_DATE, textCandidates, NOT_A_DATE, parentOf } from './patterns.js'

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
const SEP = `[\\s:：、,，—–\\-]{0,4}`

/**
 * A clock time between the label and the date.
 *
 * Bylines routinely print the time first: boingboing writes "Published 6:00 am
 * Thu, Apr 2, 2015", and with a four-character gap the label and the date never
 * meet. The optional trailing run absorbs the meridiem and the weekday — it has
 * to end in a comma, which is what keeps it from swallowing a sentence, and it
 * excludes digits so it cannot eat part of the date it is supposed to precede.
 */
const TIME_THEN_DAY = `(?:\\d{1,2}[:.]\\d{2}(?::\\d{2})?)?(?:[^\\d<>]{1,12},)?`

/**
 * An author between the label and the date.
 *
 * "Posted by typefreak on January 14th, 2009" is the default WordPress byline
 * and one of the most common date shapes on the web, and with only a
 * four-character gap the label and the date never meet — phpbb.com, arduino.cc
 * and wufoo.com each lost every page in the corpus to it.
 *
 * Both the attribution word and a following connector are required, and the name
 * between them is a greedy run of a class that excludes digits and every
 * separator. That is a cost decision as much as a correctness one: the first
 * version made the name lazy and the connector optional, which put four
 * variable-length optional groups in a row and gave the engine an exponential
 * number of ways to fail. `test/hardening.test.ts` caught it — 2318 ms against a
 * 2000 ms budget on a document built to be expensive. Requiring "by … on" makes
 * the whole segment match or fail in one attempt.
 */
const ATTRIBUTION = `by|von|par|por|da|di|door|av|przez|от|автор`
const CONNECTOR = `on|il|am|le|el|em|op|the|v|dnia`

const GAP = `${SEP}${TIME_THEN_DAY}${SEP}(?:${CONNECTOR})?${SEP}`

const MODIFIED_RE = new RegExp(`(?:${MODIFIED_LABEL_PATTERN})${GAP}(${DATE_BODY})`, 'i')
const PUBLISHED_RE = new RegExp(`(?:${PUBLISHED_LABEL_PATTERN})${GAP}(${DATE_BODY})`, 'i')

/**
 * "Posted by typefreak on January 14th, 2009" — an author between the label and
 * the date.
 *
 * The default WordPress byline, and one of the most common date shapes on the
 * web: phpbb.com, arduino.cc and wufoo.com each lost every page in the corpus to
 * it, because `GAP` allows four characters and a name is longer than that.
 *
 * Kept as its own pattern rather than folded into `GAP`, and gated behind
 * {@link HAS_ATTRIBUTION}, purely for cost. Widening `GAP` to cover it put four
 * variable-length optional groups in a row, and `test/hardening.test.ts` failed
 * at 2318 ms against a 2000 ms budget — a document of 2000 `<time>` tags pays
 * that backtracking once per tag. As a separate pattern it runs only on text
 * that actually contains an attribution word, which no such document does, so
 * the hostile case costs exactly what it did before.
 *
 * The attribution word is required; the connector after the name is not, because
 * plenty of templates write "Posted by Kevin Hale · June 22nd, 2009" with a
 * bullet where English would put "on". What keeps this from becoming "any 30
 * characters may sit between a label and a date" is the attribution word itself
 * plus the character class, which stops at a comma, colon or semicolon and so
 * cannot cross out of the byline into the next clause.
 */
const BYLINE_GAP =
  `${SEP}(?:${ATTRIBUTION})\\s[^\\d<>,:;]{1,30}${SEP}(?:${CONNECTOR})?${SEP}${TIME_THEN_DAY}${SEP}`
const MODIFIED_BYLINE_RE = new RegExp(`(?:${MODIFIED_LABEL_PATTERN})${BYLINE_GAP}(${DATE_BODY})`, 'i')
const PUBLISHED_BYLINE_RE = new RegExp(`(?:${PUBLISHED_LABEL_PATTERN})${BYLINE_GAP}(${DATE_BODY})`, 'i')

/**
 * Not implemented, and measured rather than assumed: a byline with no label word
 * at all — "By Kevin Hale · July 3rd, 2006", which is how wufoo.com writes every
 * post and how it loses all nine of its corpus pages.
 *
 * Reading a leading attribution word as a publication label, anchored to the
 * start of the element so "by" cannot be a preposition mid-sentence, recovers
 * three of those misses on the dev split and creates two new wrong answers there
 * and one more on diag. Across dev+diag that is 989 correct out of 1104 either
 * way — an exact wash, for an extra pattern in the hottest loop in the library.
 *
 * The reason it does not pay is that a byline's date is often *not* the article's
 * date: "By Jane Smith" sits above a related-articles rail as readily as above
 * the article, and the attribution word carries none of the "this document" that
 * `published` or `posted` does. Left out deliberately.
 */

/** Cheap gate: skip the byline patterns entirely on text with no attribution. */
const HAS_ATTRIBUTION = new RegExp(`(?:^|\\s)(?:${ATTRIBUTION})\\s`, 'i')

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


/**
 * Long blocks are article prose, not a byline.
 *
 * Generous, because what actually keeps this extractor honest is the adjacency
 * requirement in the patterns above — a label and a date more than ~48
 * characters apart are not describing each other — and not this cap. At 220 the
 * cap was overriding that judgement rather than supporting it: a German
 * WordPress byline reads "Dieser Beitrag wurde am 3. Dezember 2011 um 14:48
 * veröffentlicht und unter …" and then lists every category and tag on the post,
 * which runs past 220 characters *after* the part that identifies the date.
 * Rejecting the element loses a byline that the adjacency rule had already
 * accepted.
 *
 * Note this is measured on {@link directText}, which stops at block-level
 * children, so even a large value here reads one run of text rather than a whole
 * article.
 */
const MAX_TEXT_LENGTH = 600

/**
 * Elements that carry a field name in a label/value pair.
 *
 * `<dt>` is the semantic one and the rarest. Headings are what CMS templates
 * actually emit for a metadata panel, and `<th>` covers the table form.
 *
 * `<p>`, `<div>` and `<span>` are deliberately absent. They would match a field
 * label occasionally and they select essentially every element on a page, which
 * turns this pass into a second full-document walk: on the 16,000-paragraph
 * document in `test/hardening.test.ts` that is the difference between a scan and
 * a scan of everything. Measured on the dev split, adding them back is worth
 * nothing — the label/value shape is emitted with a heading or a `<dt>`, because
 * that is what makes it render as a label.
 */
const LABEL_TAGS = 'dt,th,h2,h3,h4,h5,h6,strong,b,label'

/** A value cell longer than this is prose that happens to contain a date. */
const MAX_VALUE_LENGTH = 80

/**
 * `<h5>Date</h5><p>February 9, 2021</p>` — a label and its value in *sibling*
 * elements rather than in one run of text.
 *
 * {@link extractVisibleText} requires the label and the date to share an
 * element's direct text, because in running prose that adjacency is the only
 * thing that ties them together. A label/value pair ties them structurally
 * instead, and the shape is common enough that missing it costs whole hosts:
 * ipcc.ch renders every press release this way and pagedate returned nothing at
 * all on them.
 *
 * **This deliberately ignores the furniture exclusion.** The date on those pages
 * sits in `<aside class="section-sidebar">`, and `sidebar` is excluded for good
 * reason — it is where "recent posts" lists live, and a bare date in one belongs
 * to somebody else's article. But an explicit field name is a different kind of
 * evidence from a bare date: the site is stating what this value *is*, about
 * this document. So the exclusion is traded for two narrower guards that
 * distinguish a metadata panel from a list of other articles:
 *
 * - the value element holds a date and almost nothing else, and
 * - neither element links anywhere. A "recent posts" entry is a link; a metadata
 *   field is not.
 *
 * `derived`, not `declared` — the field name is site-authored markup, but it is
 * prose in a heading rather than a machine-readable attribute, and it ranks
 * below JSON-LD and OpenGraph accordingly.
 */
export function extractLabelledPairs(
  doc: Document,
  pageUrl: URL | null,
  opts: ParseOptions = {},
): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  const pageHost = pageUrl?.hostname ?? null

  for (const label of doc.querySelectorAll(LABEL_TAGS)) {
    const labelText = collapse(directText(label))
    if (!labelText || labelText.length > 32) continue
    const field = fieldFromStandaloneLabel(labelText)
    if (!field) continue
    // A label that is itself a link is a navigation item, not a field name.
    if (label.querySelector?.('a')) continue

    // The value is the next element along; `<dt>`/`<dd>` and heading/paragraph
    // both take that shape. A wrapper with the label as its only child is the
    // third common rendering, so the parent's sibling is tried as a fallback.
    const candidates = [
      label.nextElementSibling,
      // Asked of the label rather than by counting the parent's children:
      // linkedom rebuilds `children` on every access, which made this line
      // quadratic in the width of the parent.
      !label.previousElementSibling && !label.nextElementSibling
        ? (parentOf(label)?.nextElementSibling ?? null)
        : null,
    ]

    for (const value of candidates) {
      if (!value) continue
      // A link in the value is the tell for a "related posts" block, which is
      // precisely what the furniture exclusion this function bypasses exists to
      // catch.
      if (value.querySelector?.('a') || value.tagName?.toUpperCase() === 'A') continue

      const text = collapse(value.textContent ?? '')
      if (!text || text.length > MAX_VALUE_LENGTH) continue
      if (!MAYBE_DATE.test(text) || NOT_A_DATE.test(text)) continue
      if (isBorrowedContent(value, pageHost)) continue

      const match = DATE_ANYWHERE.exec(foldCase(text))
      if (!match) continue
      const parsed = parseDateString(match[0], opts)
      if (!parsed) continue

      const key = `${field}:${parsed.value}`
      if (seen.has(key)) break
      seen.add(key)
      out.push({
        ...parsed,
        field,
        source: 'labelled-pair',
        confidence: 'derived',
        note: `"${labelText}" → "${text.slice(0, 40)}"`,
      })
      break
    }
  }

  return out
}

export function extractVisibleText(
  doc: Document,
  pageUrl: URL | null,
  opts: ParseOptions = {},
): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  const pageHost = pageUrl?.hostname ?? null

  for (const el of textCandidates(doc)) {
    // Only look at elements whose own text is short — a <div> wrapping the
    // whole article would otherwise match its first byline over and over.
    // Reject before any string work. Collapsing whitespace allocates, folding
    // is up to two Unicode normalisation passes, and the label patterns are
    // large alternations — almost every element on a page has no year in it and
    // can skip all three.
    const raw = directText(el)
    // hAtom keeps the machine value in `title` and shows only a clock time, so
    // an `<abbr>` is also let through on the strength of its attribute. Without
    // this the text fails the year test, the element is skipped here, and the
    // branch below that reads `title` is never reached.
    const titled = el.tagName?.toUpperCase() === 'ABBR' ? el.getAttribute('title') : null
    const datedTitle = titled && MAYBE_DATE.test(titled) ? titled : null
    const datedText = Boolean(raw) && MAYBE_DATE.test(raw)
    if (!datedText && !datedTitle) continue
    // Prices, versions, phone numbers and IBANs all look like dates.
    if (datedText && NOT_A_DATE.test(raw)) continue

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
      //
      // The attribute is parsed whole before it is searched. It is a timestamp,
      // and cutting the date out of it first discards the time and the offset.
      const fromTitle = datedTitle && !DATE_ANYWHERE.test(text) ? datedTitle : null
      const match = DATE_ANYWHERE.exec(fromTitle ?? text)
      const parsed =
        (fromTitle ? parseDateString(fromTitle, opts) : null) ??
        (match ? parseDateString(match[0], opts) : null)
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

    // Only the attribute carried a date, and only the branch above reads it.
    if (!datedText) continue

    // Tested once per element rather than once per pattern, and only when the
    // text could contain a byline at all.
    const byline = HAS_ATTRIBUTION.test(text)

    for (const [regex, field, needsMarkup, needsAttribution] of [
      [MODIFIED_RE, 'modified', false, false],
      [PUBLISHED_RE, 'published', false, false],
      [MODIFIED_BYLINE_RE, 'modified', false, true],
      [PUBLISHED_BYLINE_RE, 'published', false, true],
      [MODIFIED_AFTER_RE, 'modified', true, false],
      [PUBLISHED_AFTER_RE, 'published', true, false],
    ] as const) {
      if (needsAttribution && !byline) continue
      // The date-then-label form only inside markup that names the element as
      // article furniture. "Published on 3 March" labels itself whatever it sits
      // in; a date followed 48 characters later by the word "published" is only
      // a byline if the markup says the element is one. In running prose it is a
      // sentence — Daring Fireball links to a report "on 5 October 2018, just
      // after the original report was published", and read as a byline that
      // dates the page two and a half years early.
      if (needsMarkup && !context.strong) continue

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

