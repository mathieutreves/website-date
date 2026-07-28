import type { Candidate, Field } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'

/**
 * Dates in the state blob a page inlines for its own JavaScript.
 *
 * Plenty of pages carry no machine-readable date in their markup and render the
 * byline as prose, or as something no parser can use at all — TechCrunch in 2012
 * printed `<div class="post-time">posted yesterday</div>` — while a `<script>`
 * further down hands the same page's JavaScript an exact timestamp:
 *
 *     {"post_title":"…","post_date":"2012-11-02 11:20:30","post_status":"publish"}
 *
 * That is the site stating its own publication date, so it is read as one. It
 * is the last resort of the DOM-only signals, not a first choice: the blob is an
 * implementation detail rather than a published contract, and it is scored
 * `derived` accordingly.
 *
 * `application/ld+json` is deliberately excluded — {@link extractJsonLd} parses
 * those properly, and reading them twice would double-count a stronger signal at
 * a weaker confidence.
 *
 * **The key list is an allow-list, and stays one.** A bare `date` or `timestamp`
 * appears in analytics config, comment payloads, ad slots and cookie banners; on
 * this corpus TechCrunch alone emits a `"date"` key on 30 pages, and taking it
 * would be reading an arbitrary JavaScript variable and calling it publication
 * metadata. Every key below either names the post explicitly or is a WordPress
 * column name, which is why they generalise past the sites they were found on.
 */

/**
 * Anchored, every one of them.
 *
 * An unanchored alternation matches a *substring* of the key, which is not what
 * an allow-list means: `updated_?at` accepted `updateDate`, because "updatedat"
 * sits inside "updatedate". That is how a list written to be conservative
 * quietly stops being one — the failure is silent, and it grows with every
 * pattern added.
 */
const KEYS: Array<[RegExp, Field, string]> = [
  // WordPress column names (`post_date`, `post_date_gmt`, `post_modified`) and
  // the REST API's renaming of them (`date`/`date_gmt` → only accepted with the
  // `_gmt` suffix, which is unambiguous where the bare form is not).
  [/^post_?date(_?gmt)?$/i, 'published', 'wordpress'],
  [/^post_?modified(_?gmt)?$/i, 'modified', 'wordpress'],
  [/^date_?gmt$/i, 'published', 'wordpress'],
  [/^modified_?gmt$/i, 'modified', 'wordpress'],

  // Framework and CMS state: Next.js page props, Nuxt payloads, headless CMSes.
  [/^(date_?published|published_?date|published_?at|publish_?date|first_?published_?at)$/i, 'published', 'inline-state'],
  [/^(date_?modified|modified_?date|modified_?at|updated_?at)$/i, 'modified', 'inline-state'],
]

/**
 * One pass over the script text, anchored on the *value* rather than the key.
 *
 * A page's inline scripts run to hundreds of kilobytes, so what this pattern
 * starts with decides the cost of the whole extractor. Leading with the key —
 * `["']?([A-Za-z_][A-Za-z0-9_]{2,30})["']?\s*[:=]\s*` — makes an identifier
 * character class the first mandatory token, and in minified JavaScript nearly
 * every offset starts an identifier: the engine attempts a match at almost every
 * character, consumes up to 30 of them, then backtracks. Leading with the date
 * literal instead gives it a rare, highly selective anchor and turns that crawl
 * into a sparse search. Measured over the whole corpus: same 868 matches, 17x
 * faster.
 *
 * The key is then recovered from the text immediately before the match, by
 * {@link KEY_BEFORE}.
 */
const ENTRY =
  /["'](\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)["']/g

/**
 * The key naming a matched value, read backwards from just before it.
 *
 * Anchored at the end so it binds to the key adjacent to *this* value rather
 * than an earlier one on the same line.
 */
const KEY_BEFORE = /([A-Za-z_][A-Za-z0-9_]{2,30})["']?\s*[:=]\s*$/

/**
 * How far back to look for the key. A 30-character key plus quotes, a
 * separator and the whitespace a pretty-printer puts around it fit well inside
 * this; minified source needs a fraction of it.
 */
const KEY_LOOKBACK = 64

/**
 * Cheap rejection before the real scan. Without a date-shaped literal anywhere
 * in the script there is nothing to find, and this skips the analytics and
 * framework bundles that make up most inline script bytes on a page.
 */
const HAS_DATE_LITERAL = /["']\d{4}-\d{2}-\d{2}/

/**
 * Cap on script text scanned per document.
 *
 * State blobs are emitted near the markup they describe and are small; a
 * megabyte of inlined framework bundle is not one. The cap bounds the worst case
 * on script-heavy pages without changing the answer on any page in the corpus.
 */
const MAX_SCAN = 512_000

export function extractInlineState(doc: Document, opts: ParseOptions = {}): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  let budget = MAX_SCAN

  for (const script of doc.querySelectorAll('script')) {
    if (budget <= 0) break

    const type = script.getAttribute('type')
    // Only the types somebody else owns, or that cannot hold a state blob.
    //
    // A blanket `json` test was excluding the richest source of these: Next.js
    // ships its page props as `<script id="__NEXT_DATA__" type="application/json">`,
    // and htmldate reads `application/settings+json` for the same reason. Those
    // are exactly the state blobs this extractor exists to read, and skipping
    // every declared JSON type left it seeing only the untyped ones.
    // `ld+json` stays excluded — {@link extractJsonLd} parses it properly, and
    // reading it here would double-count a stronger signal at a weaker tier.
    if (type && /ld\+json|importmap|speculationrules/i.test(type)) continue

    // Truncated to the remaining budget rather than merely counted against it.
    // Checking `budget` only between scripts left the cap describing something
    // it did not enforce: one 20 MB `<script>` was scanned end to end, because
    // nothing consulted the budget until the next iteration.
    const raw = script.textContent
    const text = raw && raw.length > budget ? raw.slice(0, budget) : raw
    if (!text || !HAS_DATE_LITERAL.test(text)) continue
    budget -= text.length

    ENTRY.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = ENTRY.exec(text)) !== null) {
      const before = text.slice(Math.max(0, match.index - KEY_LOOKBACK), match.index)
      const key = KEY_BEFORE.exec(before)?.[1]
      if (!key) continue

      const rule = KEYS.find(([pattern]) => pattern.test(key))
      if (!rule) continue

      const [, field, source] = rule
      // A space-separated `2012-11-02 11:20:30` is not ISO, and the parser reads
      // it at minute precision only once the separator is one it recognises.
      const parsed = parseDateString(match[1]!.replace(' ', 'T'), opts)
      if (!parsed) continue

      const dedupe = `${field}:${parsed.value}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)

      out.push({
        ...parsed,
        field,
        source,
        // Structured and site-authored, but an internal detail rather than a
        // published contract — the same tier as Dublin Core, below OpenGraph.
        confidence: 'derived',
        note: `inline script ${key}`,
      })
    }
  }

  return out
}
