/**
 * Is this document a listing rather than a document?
 *
 * A homepage, a section front and a tag archive all carry dozens of dates and
 * none of them are the page's own: they belong to the articles being listed.
 * Every DOM-scraped extractor here is built to find the date *near the content*,
 * and on a listing there is no content to be near — so `<time>` in the first
 * card, or the date beside the top headline, reads exactly like a byline and is
 * returned as the page's publication date.
 *
 * Measured on the corpus's no-date tier, which is 99 bare homepages and 55
 * section pages: pagedate answered on 41 of 70 such pages in the dev split.
 * `marked-date` supplied 20 of those answers and `time-tag` 14 — in every case
 * the date of the newest item in a list. That is not a parsing bug in any one
 * extractor; it is the whole class of them being asked a question the page does
 * not answer.
 *
 * This cannot be scored on a corpus where every page has a date, which is why it
 * survived until a negative tier existed to point at it.
 */

/** Containers that mean "the article body is here". */
const ARTICLE_BODY =
  '[itemprop="articleBody"],.post-content,.entry-content,.article-body,.post-body,.article__body,.story-body'

/**
 * Positive evidence that this *is* an article, from the page's own declarations.
 *
 * Checked first and treated as decisive. A site that says `og:type=article` or
 * emits `"@type":"NewsArticle"` has stated what the document is, and no amount
 * of counting `<h2>` elements should overrule it — measured across the corpus,
 * 77% of dated articles declare `og:type=article` against 12% of listings, and
 * JSON-LD `Article` separates them 43% to 1%.
 */
function declaresItselfAnArticle(doc: Document): boolean {
  const ogType = doc
    .querySelector('meta[property="og:type"],meta[name="og:type"]')
    ?.getAttribute('content')
    ?.trim()
    .toLowerCase()
  if (ogType === 'article') return true

  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const text = script.textContent ?? ''
    // Substring rather than a parse: this runs before extraction and only needs
    // to know whether an Article type is claimed anywhere in the block. The
    // JSON-LD extractor does the real parsing.
    if (/"@type"\s*:\s*"[^"]*(?:Article|BlogPosting|Report|Review)"/i.test(text)) return true
  }
  return false
}

/**
 * How many dates-in-a-list this page shows.
 *
 * `<time>` is counted rather than resolved candidates, because the question is
 * about the shape of the document and needs answering before any extractor
 * runs. Listings average 20.9 `<time>` elements against 3.8 on articles.
 */
function listingWeight(doc: Document): number {
  let weight = 0

  const ogType = doc
    .querySelector('meta[property="og:type"],meta[name="og:type"]')
    ?.getAttribute('content')
    ?.trim()
    .toLowerCase()
  // 30% of listings declare this against 4% of articles. Not decisive alone —
  // plenty of blogs put `website` on every page including their posts.
  if (ogType === 'website') weight += 2

  // A wall of headings is what a list of links looks like structurally.
  if (doc.querySelectorAll('h2,h3').length >= 12) weight += 1

  if (doc.querySelectorAll('time').length >= 10) weight += 2

  // Several sibling <article> elements is the semantic spelling of a feed.
  if (doc.querySelectorAll('article').length >= 3) weight += 1

  return weight
}

/**
 * The test itself, deliberately conservative in one direction.
 *
 * A false "this is an index" silently deletes the correct answer from a real
 * article, which is a worse failure than the one being fixed: an invented date
 * is visible and arguable, a suppressed one is not. So an explicit article
 * declaration or an article-body container ends it immediately, and what remains
 * has to clear a threshold rather than trip a single rule.
 */
export function isIndexPage(doc: Document): boolean {
  if (declaresItselfAnArticle(doc)) return false
  if (doc.querySelector(ARTICLE_BODY)) return false
  return listingWeight(doc) >= 3
}

/**
 * Sources whose evidence is a date sitting in the document body.
 *
 * These are the ones a listing defeats, because on a listing the body is other
 * documents' metadata. Everything absent from this set is either a page-level
 * declaration (`jsonld`, `opengraph`, `meta-date`) or comes from outside the
 * document entirely (`url-slug`, `atom-feed`, `sitemap`), and stays.
 *
 * `opengraph` is deliberately kept even though it supplied 4 false positives:
 * `article:published_time` on a homepage is wrong, but it is the *site* stating
 * it, and suppressing a declared value on a heuristic verdict about page shape
 * inverts the confidence tiers this library is built on. That belongs in a
 * conflict, not in a filter.
 */
const BODY_SCRAPED = new Set([
  'marked-date',
  'time-tag',
  'text-date',
  'visible-text',
  'bare-text',
  'page-scan',
  'labelled-pair',
])

export const isBodyScraped = (source: string): boolean => BODY_SCRAPED.has(source)
