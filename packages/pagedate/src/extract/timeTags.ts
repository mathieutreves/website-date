import type { Candidate } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'
import { marksPublication, scoreContext, surroundingText } from './context.js'
import { fieldFromLabel } from './labels.js'

/**
 * `<time datetime>` elements, filtered by context.
 *
 * The `datetime` attribute is machine-readable and usually correct, but the
 * element is just as often part of a "recent posts" list as it is the article's
 * byline — so context filtering does most of the work here, not parsing.
 */
export function extractTimeTags(doc: Document, opts: ParseOptions = {}): Candidate[] {
  const out: Candidate[] = []

  for (const el of doc.querySelectorAll('time[datetime], time[pubdate]')) {
    const attr = el.getAttribute('datetime')?.trim()
    const own = el.textContent?.trim()
    const raw = attr || own
    if (!raw) continue

    const context = scoreContext(el)
    if (!context.usable) continue

    const parsed = parseDateString(raw, opts)
    if (!parsed) continue

    const nearby = surroundingText(el)
    let field = fieldFromLabel(nearby)

    // The legacy `pubdate` attribute is an explicit publication marker.
    if (field === 'unknown' && el.hasAttribute('pubdate')) field = 'published'

    // Markup naming the container a publication block is a clearer statement
    // than the absence of wording around the date: `<p class="publication">
    // <time datetime=…>` says what it is without a label to read.
    if (field === 'unknown' && marksPublication(context.marker)) field = 'published'

    // An itemprop on the element itself beats guessing from prose.
    const itemprop = el.getAttribute('itemprop')?.toLowerCase()
    if (itemprop === 'datepublished') field = 'published'
    if (itemprop === 'datemodified') field = 'modified'

    // A `<time>` whose own text says "Publié le 29 juin 2019" while its
    // datetime attribute reads 2019-07-03 is stating two different things. The
    // text carries an explicit publication label; the attribute carries none,
    // and on these pages it is an indexing or last-touched stamp. The stated
    // intent wins over the bare machine value.
    if (attr && own && field === 'published') {
      const fromText = parseDateString(own, opts)
      if (
        fromText &&
        fromText.value.slice(0, 10) !== parsed.value.slice(0, 10) &&
        fieldFromLabel(own) === 'published'
      ) {
        out.push({
          ...fromText,
          field: 'published',
          source: 'time-tag',
          confidence: 'derived',
          note: `<time> text is labelled a publication date, disagreeing with its datetime="${attr.slice(0, 10)}"`,
        })
        continue
      }
    }

    out.push({
      ...parsed,
      field,
      source: 'time-tag',
      confidence: 'derived',
      note: context.strong ? '<time> in byline markup' : '<time> in article context',
    })
  }

  return demoteListing(out)
}

/**
 * More unlabelled `<time>` tags than an article has is a listing, not an article.
 *
 * A related-articles rail is a run of `<time>` elements that no context marker
 * can reach: modern builds hash their class names (`css-dozr74`), so the
 * sidebar/related/widget vocabulary has nothing to match and every teaser scores
 * as "article context". BBC Chinese renders fifteen that way, six of them years
 * old, which was enough to trip `predated-content` and tell the reader a
 * correctly-dated article had been republished.
 *
 * Counting is what distinguishes them. An article states its own date once or
 * twice; it does not state fifteen. The same reasoning already caps
 * {@link extractBareText} at six candidates.
 *
 * Demoted rather than dropped — a reader inspecting every date on the page
 * should still see them. `inferred` keeps them out of the `predated-content`
 * evidence set, which counts only machine-readable timestamps, and ranks them
 * below anything that speaks about this document.
 *
 * Tags carrying a field label are left alone: a page that says "published" and
 * "updated" in markup is describing itself however many times it does it.
 */
const MAX_UNLABELLED_TIME_TAGS = 5

function demoteListing(candidates: Candidate[]): Candidate[] {
  const unlabelled = candidates.filter((c) => c.field === 'unknown')
  if (unlabelled.length <= MAX_UNLABELLED_TIME_TAGS) return candidates

  return candidates.map((c) =>
    c.field === 'unknown'
      ? {
          ...c,
          confidence: 'inferred',
          note: `<time> in a run of ${unlabelled.length} unlabelled ones — a listing, not this page's date`,
        }
      : c,
  )
}
