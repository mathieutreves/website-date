/**
 * Shared "is this element part of the article, or part of the furniture?" test.
 *
 * Used by both the `<time>` and visible-text extractors. Without it, a "Recent
 * posts" sidebar reliably wins over the article's own byline — the sidebar
 * usually has *more* dates and they're usually *newer*.
 */

import { boundedText, parentOf } from './patterns.js'

/**
 * Class/id tokens that mark listing furniture across most themes.
 *
 * Anchored at the start of a token, deliberately. Matching anywhere inside one
 * treats VitePress's `has-sidebar` — a layout modifier meaning "this page has a
 * sidebar" — as if the element *were* a sidebar, which discards the whole page.
 * A false exclusion loses the date permanently, so this side errs strict.
 */
/*
 * `logo`, `masthead`, `banner` and `brand` name the site's identity block, and
 * a great many news sites print today's date in it. That date is the clock, not
 * the article: on the Russian pages in the corpus it is the only thing standing
 * between a correct answer and a confident wrong one, because the masthead date
 * comes first in document order and ties there fall to document order. Nothing
 * legitimately dates an article from inside its own logo, so this is the rare
 * exclusion with no plausible false positive.
 *
 * `current`, `clock` and `today` are here for the same reason one step further
 * in. `<div id="current-time">` is a clock, but the generic `time` marker in
 * ARTICLE_PATTERN reads it as a date block and promotes it to `derived` — which
 * is *above* the tier a genuine byline reaches on those pages, so the clock does
 * not merely tie with the article date, it beats it. A container that names
 * itself for the present moment is asserting the reader's clock, never the
 * document's date.
 */
const EXCLUDED_PATTERN =
  /^(related|recent|popular|trending|sidebar|widget|nav|menu|comment|reply|breadcrumb|pagination|newsletter|promo|advert|teaser|card-list|post-list|archive-list|logo|masthead|banner|brand|current|clock|today)([-_]|$)/i

/** Containers that positively indicate article body content. */
/**
 * Markup that positively marks a date block.
 *
 * Includes bare `date`/`datum` because CMS themes name these containers
 * literally — `news-list-date`, `PublishDate_date`, `blogData` — and German
 * sites in particular put the date in a labelled block with a weekday and a
 * time around it, which the ratio guard would otherwise reject.
 */
const MARKER_VOCABULARY =
  'byline|dateline|post-meta|entry-meta|article-meta|published|publish-date|posted-on|posted|pubdate|last-updated|lastmod|updated|submitted|created|publication|post-date|entry-date|date|datum|erstellt|veroffentlicht|author|autor|fecha|parution|subline|info|meta|footer|time|publish|created-post|post-detail|field-content|postdate|entrydate|publishdate|dateposted|datepublished|datetag|datestamp|timestamp|articledate|storydate|newsdate|datetime|postmeta'

const ARTICLE_PATTERN = new RegExp(`(^|[-_\\s])(${MARKER_VOCABULARY})([-_\\s]|$)`, 'i')

/**
 * The same vocabulary, scanned repeatedly across one token.
 *
 * The trailing boundary is a lookahead so it is not consumed: a separator has to
 * be available again to open the next match, and `post-meta-date` would
 * otherwise report only `post-meta`.
 */
const MARKER_SCAN = new RegExp(`(?:^|[-_\\s])(${MARKER_VOCABULARY})(?=[-_\\s]|$)`, 'gi')

/** Every vocabulary word in one class token, in order. */
function markersIn(token: string): string[] {
  MARKER_SCAN.lastIndex = 0
  const out: string[] = []
  for (const m of token.matchAll(MARKER_SCAN)) out.push(m[1]!.toLowerCase())
  return out
}

/**
 * The strongest thing a set of markers says.
 *
 * One class name routinely contains two vocabulary words of very different
 * strength — Meduza's date block is `MaterialMeta--time`, which says both `meta`
 * ("metadata lives here") and `time` ("and it is a date"). Taking whichever came
 * first in the string picked `meta`, so the element was worth *looking* at but
 * asserted nothing, and the article's own date was left unlabelled while a rail
 * of neighbouring `<time>` tags outranked it. Position in a class name carries no
 * meaning; specificity does.
 */
function mostSpecific(markers: string[]): string | undefined {
  return (
    markers.find((m) => marksPublication(m) || marksModification(m)) ??
    markers.find(marksDateBlock) ??
    markers[0]
  )
}

/**
 * Split camelCase so framework class names match the patterns above:
 * VitePress emits `VPLastUpdated`, which only reads as `last-updated` once
 * the word boundaries are made explicit.
 */
function normaliseMarker(marker: string): string {
  return marker.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

export type ContextScore = {
  /** False when the element sits in furniture and should be discarded outright. */
  usable: boolean
  /** True when the element sits in markup that positively signals a byline. */
  strong: boolean
  /** Which positive marker matched, when one did — e.g. `entry-date`, `byline`. */
  marker?: string
}

/**
 * Markers that name the element as a *publication* date specifically, rather
 * than merely as article furniture. Enough on their own to label a bare `<time>`
 * that carries no wording around it.
 */
const PUBLICATION_MARKERS = new Set([
  'byline',
  'dateline',
  'published',
  'publication',
  'publish-date',
  'posted-on',
  'posted',
  'pubdate',
  'entry-date',
  'post-date',
  // The same names written as one word. The vocabulary is matched on separators
  // — `post-date`, `post_date`, `PostDate` — and a theme that writes `postdate`
  // has none, so without these it says nothing at all.
  'postdate',
  'entrydate',
  'publishdate',
  'dateposted',
  'datepublished',
])

export const marksPublication = (marker: string | undefined): boolean =>
  marker !== undefined && PUBLICATION_MARKERS.has(marker)

/** Markers naming the element as a *modification* date. */
const MODIFICATION_MARKERS = new Set(['last-updated', 'lastmod', 'updated'])

export const marksModification = (marker: string | undefined): boolean =>
  marker !== undefined && MODIFICATION_MARKERS.has(marker)

/**
 * The field a container's own markup asserts, if any.
 *
 * `<span class="PublishDate_date">29. Januar 2019</span>` states what it holds
 * as plainly as the words "Published on" would. Treating the class name as the
 * label is what lets a bare date in a marked container be read confidently,
 * rather than being left unlabelled and outranked by something worse.
 */
/**
 * Markers naming the element as a date block, whichever kind.
 *
 * Deliberately narrower than the context vocabulary. `footer`, `meta`, `info`
 * and `author` are good reasons to *look* at an element — a date is often
 * nearby — but they do not assert that what is found is this page's date. A
 * newspaper's registration date sits in a footer too.
 */
const DATE_BLOCK_MARKERS = new Set([
  ...PUBLICATION_MARKERS,
  ...MODIFICATION_MARKERS,
  'date',
  'datum',
  'time',
  'fecha',
  'parution',
  'dateline',
  'post-meta',
  // Compounds, for the same reason as the ones in PUBLICATION_MARKERS.
  // MacRumors dated every story in `<span class="datetag">`.
  'datetag',
  'datestamp',
  'timestamp',
  'articledate',
  'storydate',
  'newsdate',
  'datetime',
  'postmeta',
])

/*
 * Deliberately excluded from the set above: entry-meta, meta, info, footer,
 * subline. `info` was tested on its own and wins two external pages while
 * costing a local false positive; `post-meta` wins the same and costs nothing,
 * so it is in and `info` is not. Adding them wins three pages on the external corpus — 58.2%
 * to 63.6% — and costs two false positives locally, including a Korean
 * newspaper's registration date lifted out of a page footer.
 *
 * That trade is refused. The external corpus contains only pages that have a
 * date, so it cannot reward answering "there is none" correctly; the local one
 * is built to test exactly that. Optimising against a benchmark that is blind
 * to the property this library exists for, at the cost of that property, buys a
 * number and sells the thing the number is supposed to stand for.
 */

export const marksDateBlock = (marker: string | undefined): boolean =>
  marker !== undefined && DATE_BLOCK_MARKERS.has(marker)

/**
 * Markers naming a region of the *page* rather than metadata about the article.
 *
 * `footer` is in {@link ARTICLE_PATTERN} because documentation sites put their
 * "Last updated" line in a page-level footer and the header/footer rule would
 * otherwise discard it. That is a reason to read a *labelled* date there. It is
 * not a reason to accept a bare date buried in a footer sentence: Il Post ends
 * every page with "Il Post è una testata registrata presso il Tribunale di
 * Milano, 419 del 28 settembre 2009", and on the strength of `footer` alone that
 * registration date was read as the publication date of every article on the
 * site.
 *
 * Distinguished here rather than by removing `footer` from the vocabulary,
 * because the two extractors genuinely want different answers from it.
 */
const PAGE_REGION_MARKERS = new Set(['footer'])

export const marksPageRegion = (marker: string | undefined): boolean =>
  marker !== undefined && PAGE_REGION_MARKERS.has(marker)

export function fieldFromMarker(marker: string | undefined): 'published' | 'modified' | 'unknown' {
  if (marksModification(marker)) return 'modified'
  if (marksPublication(marker)) return 'published'
  return 'unknown'
}

export function scoreContext(el: Element): ContextScore {
  let strong = false
  let marker: string | undefined
  let sawArticle = false
  let sawHeaderFooter = false
  // Depths are tracked so proximity can decide between a positive and a
  // negative signal, rather than whichever happens to be met first.
  let strongDepth = Infinity
  let excludedDepth = Infinity
  let node: Element | null = el
  let depth = 0

  // The walk goes child → parent, so `<header>` is always reached before the
  // `<article>` that may contain it. Whether a header counts as furniture
  // therefore can't be decided in the loop — it's deferred until the end.
  while (node && depth < 24) {
    const tag = node.tagName?.toUpperCase()

    // `<nav>` is navigation and never dates the article. `<aside>` is not the
    // same thing: at page level it is a sidebar, but *inside* an article it is
    // routinely that article's own metadata block — ebene11.com puts the whole
    // byline in `<aside class="blogData">` inside `<article>`, and a blanket
    // exclusion threw the only date on the page away. So it is deferred to the
    // end and decided by whether an `<article>` encloses it, exactly as
    // `<header>` and `<footer>` already are.
    if (tag === 'NAV') excludedDepth = Math.min(excludedDepth, depth)
    if (tag === 'HEADER' || tag === 'FOOTER' || tag === 'ASIDE') sawHeaderFooter = true
    if (tag === 'ARTICLE' || tag === 'MAIN') sawArticle = true

    const rawMarker = `${node.getAttribute?.('class') ?? ''} ${node.getAttribute?.('id') ?? ''}`
    if (rawMarker.trim()) {
      // Tokenised, so `has-sidebar` and `sidebar` are told apart. Exclusion is
      // matched per token and anchored; the positive hint stays unanchored
      // because a missed hint only reorders, while a wrong exclusion is fatal.
      const tokens = rawMarker.split(/\s+/).filter(Boolean).map(normaliseMarker)

      if (excludedDepth === Infinity && tokens.some((t) => EXCLUDED_PATTERN.test(t))) {
        excludedDepth = depth
      }

      // One token cannot both condemn an element and vouch for it. `current-time`
      // matches the exclusion on `current` and the date-block vocabulary on
      // `time`, at identical depth — and since proximity decides ties in favour
      // of the positive marker, the exclusion would never once have fired.
      // Scanning only the tokens that did not exclude keeps the two vocabularies
      // from cancelling out, without weakening the proximity rule that resolves
      // genuine disagreements between *different* ancestors.
      if (!strong) {
        const hit = mostSpecific(
          tokens.filter((t) => !EXCLUDED_PATTERN.test(t)).flatMap(markersIn),
        )
        if (hit) {
          strong = true
          marker = hit
          strongDepth = depth
        }
      }
    }

    node = parentOf(node)
    depth++
  }

  // Proximity decides. A `<time class="entry-date">` inside `<span
  // class="byline">` is a byline whatever a distant layout wrapper's class
  // says — and wrappers routinely carry names like `site-content sidebar-left`
  // describing the *page*, not the element. Excluding on those discards the
  // whole article; requiring the positive marker to be nearer than the negative
  // one keeps genuine furniture (comment blocks, promo lists) excluded, because
  // there the negative marker is the closer of the two.
  const excluded = excludedDepth !== Infinity && strongDepth > excludedDepth
  if (excluded) return { usable: false, strong: false }

  // A header or footer nested inside the article is exactly where bylines live;
  // one at page level is site furniture — unless the element itself is marked as
  // a date block. Documentation sites rarely use <article> and put their
  // "Last updated" in a page-level footer, which the plain rule would discard.
  if (sawHeaderFooter && !sawArticle && !strong) return { usable: false, strong: false }

  return marker ? { usable: true, strong, marker } : { usable: true, strong }
}

/** How much text around an element is enough to tell "published" from "updated". */
const NEARBY_LIMIT = 400

/**
 * Nearby text used to tell "published" from "updated". Looks at the element,
 * its parent, and the text immediately preceding it.
 *
 * Each piece is gathered through {@link boundedText} rather than `textContent`,
 * and the label is capped too: the result is truncated to {@link NEARBY_LIMIT}
 * either way, so reading a whole subtree — or a whole `title` attribute — to
 * throw all but the first 400 characters away is pure cost, and cost the page
 * gets to choose. Same answer on any real document; bounded on a hostile one.
 */
export function surroundingText(el: Element, parentTexts?: Map<Element, string>): string {
  const own = boundedText(el, NEARBY_LIMIT)
  const parentEl = parentOf(el)
  // Siblings share a parent, and its text is the same for each of them. A
  // caller walking many elements passes a map so it is read once per parent:
  // under linkedom every read of `childNodes` rebuilds the list, and ten
  // thousand sibling `<time>` tags cost ten seconds that way.
  let parent = ''
  if (parentEl) {
    parent = parentTexts?.get(parentEl) ?? boundedText(parentEl, NEARBY_LIMIT)
    parentTexts?.set(parentEl, parent)
  }
  const label = (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '').slice(
    0,
    NEARBY_LIMIT,
  )
  return `${label} ${parent} ${own}`.slice(0, NEARBY_LIMIT)
}
