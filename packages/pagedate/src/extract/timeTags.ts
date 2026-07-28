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

  return out
}
