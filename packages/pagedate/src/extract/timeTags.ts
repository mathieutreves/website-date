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
    const raw = el.getAttribute('datetime')?.trim() || el.textContent?.trim()
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
