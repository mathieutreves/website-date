import type { Candidate } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'
import { foldCase } from '../parse/locale.js'
import { scoreContext } from './context.js'
import { collapse, DATE_BODY, directText, MAYBE_DATE, NOT_A_DATE, textCandidates } from './patterns.js'

/**
 * Last resort: the date this page repeats most often.
 *
 * Every other extractor here asks *where* a date sits — in metadata, in a
 * container the site named, next to a word like "published". This one asks
 * nothing about position at all. It reads every date the document renders,
 * counts them, and returns the most frequent.
 *
 * That is a real signal and not only a guess. A page's own date is typically
 * printed more than once — byline, `<title>` furniture, a share widget, a
 * breadcrumb — while dates it merely mentions appear once each. It is also the
 * mechanism behind htmldate's extensive mode, which is how that tool never
 * declines to answer, and porting it is the only way to close a recall gap that
 * no amount of better *targeting* can close: on the pages this rescues there is
 * nothing to target.
 *
 * It is confined to `extensive`, and within `extensive` to documents where every
 * other extractor came back empty, because it is exactly the trade the rest of
 * this library refuses by default. It cannot tell a publication date from a
 * conference date in the body text, so it is emitted `inferred`, `unknown`, and
 * ranked below every other source. A caller who would rather have nothing than a
 * guess should not be in `extensive` mode, and `minConfidence` will drop it in
 * any case.
 *
 * Attributes are deliberately not scanned, which is where this parts company
 * with htmldate. The dates hiding in `href`s and `value`s belong to other
 * documents and to the crawler — a link to a different article, a date-picker
 * default rendered at fetch time — and reading them is how four of the six
 * corrections in `corpus-external/corrections.json` came to be wrong in the
 * first place. Rendered text is what the page told a reader.
 */

/** Global form of the shared date grammar, for counting every occurrence. */
const DATE_GLOBAL = new RegExp(DATE_BODY, 'gi')

/**
 * How many times the winning date must appear.
 *
 * Kept at 1 — a single rendered date on a page that has no other is exactly the
 * case this exists to rescue, and most of the recall is there. Requiring 2 was
 * measured: it removes one of the two false positives this extractor introduces
 * on undated pages, and simultaneously removes the entire gain on the htmldate
 * corpus (+1.8pt to nothing) and on the permalink dev split. That is a bad
 * trade in both directions at once — it buys back half the precision cost by
 * giving up nearly all of the recall it was added for. If the abstention
 * property matters more than recall for your use, the answer is not this
 * constant, it is to stay in `standard`.
 */
const MIN_LEAD = 1

/**
 * Text longer than this in one block is prose, and prose mentions dates it is
 * not dated by. Generous — the point of this extractor is coverage — but a whole
 * article body arriving as one string would let a historical narrative outvote
 * the byline.
 */
const MAX_BLOCK_LENGTH = 400

export function extractPageScan(doc: Document, opts: ParseOptions = {}): Candidate[] {
  const counts = new Map<string, { n: number; precision: Candidate['precision'] }>()

  for (const el of textCandidates(doc)) {
    const raw = directText(el)
    if (!raw || !MAYBE_DATE.test(raw)) continue
    if (NOT_A_DATE.test(raw)) continue

    /*
     * Furniture is still furniture.
     *
     * "Asks nothing about position" above means it needs no *label* and no
     * marked container — not that it reads navigation, comment threads and
     * sidebars. Those are where other documents' dates live, and counting them
     * is how `<aside class="recent-posts">` becomes a page's publication date on
     * a page that has none. That exclusion is a guarantee the rest of the
     * library makes and tests; an extractor that only runs when everything else
     * declined must not be the one that quietly revokes it.
     *
     * The same `scoreContext().usable` gate `extractBareText` applies, so the
     * two agree about what counts as the page's own voice. What still separates
     * them — and what this extractor is actually for — is everything after that
     * point: bareText needs the date to *be* the element's text, while this
     * counts dates diluted in prose up to MAX_BLOCK_LENGTH.
     */
    if (!scoreContext(el).usable) continue

    const collapsed = collapse(raw)
    if (collapsed.length > MAX_BLOCK_LENGTH) continue

    const text = foldCase(collapsed)
    DATE_GLOBAL.lastIndex = 0
    for (const match of text.matchAll(DATE_GLOBAL)) {
      const parsed = parseDateString(match[0], opts)
      if (!parsed) continue
      const seen = counts.get(parsed.value)
      if (seen) seen.n++
      else counts.set(parsed.value, { n: 1, precision: parsed.precision })
    }
  }

  if (counts.size === 0) return []

  // Most frequent wins; ties go to the earliest, because a page accumulates
  // dates *after* it is published — updates, comments, "see also" rails — and
  // none of them can predate it.
  let bestValue: string | undefined
  let best: { n: number; precision: Candidate['precision'] } | undefined
  for (const [value, entry] of counts) {
    if (!best || entry.n > best.n || (entry.n === best.n && value < bestValue!)) {
      best = entry
      bestValue = value
    }
  }

  if (!best || !bestValue || best.n < MIN_LEAD) return []

  return [
    {
      value: bestValue,
      precision: best.precision,
      field: 'unknown',
      source: 'page-scan',
      confidence: 'inferred',
      note:
        counts.size === 1
          ? 'the only date rendered anywhere on the page'
          : `the date this page renders most often (${best.n}×, of ${counts.size} distinct)`,
    },
  ]
}
