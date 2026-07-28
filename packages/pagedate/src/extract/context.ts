/**
 * Shared "is this element part of the article, or part of the furniture?" test.
 *
 * Used by both the `<time>` and visible-text extractors. Without it, a "Recent
 * posts" sidebar reliably wins over the article's own byline — the sidebar
 * usually has *more* dates and they're usually *newer*.
 */

/**
 * Class/id tokens that mark listing furniture across most themes.
 *
 * Anchored at the start of a token, deliberately. Matching anywhere inside one
 * treats VitePress's `has-sidebar` — a layout modifier meaning "this page has a
 * sidebar" — as if the element *were* a sidebar, which discards the whole page.
 * A false exclusion loses the date permanently, so this side errs strict.
 */
const EXCLUDED_PATTERN =
  /^(related|recent|popular|trending|sidebar|widget|nav|menu|comment|reply|breadcrumb|pagination|newsletter|promo|advert|teaser|card-list|post-list|archive-list)([-_]|$)/i

/** Containers that positively indicate article body content. */
/**
 * Markup that positively marks a date block.
 *
 * Includes bare `date`/`datum` because CMS themes name these containers
 * literally — `news-list-date`, `PublishDate_date`, `blogData` — and German
 * sites in particular put the date in a labelled block with a weekday and a
 * time around it, which the ratio guard would otherwise reject.
 */
const ARTICLE_PATTERN =
  /(^|[-_\s])(byline|dateline|post-meta|entry-meta|article-meta|published|publish-date|posted-on|posted|pubdate|last-updated|lastmod|updated|submitted|created|publication|post-date|entry-date|date|datum|erstellt|veroffentlicht|author|autor|fecha|parution|subline|info|meta|footer|time|publish|created-post|post-detail|field-content)([-_\s]|$)/i

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

    if (tag === 'NAV' || tag === 'ASIDE') excludedDepth = Math.min(excludedDepth, depth)
    if (tag === 'HEADER' || tag === 'FOOTER') sawHeaderFooter = true
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

      if (!strong) {
        const hit = tokens.map((t) => ARTICLE_PATTERN.exec(t)?.[2]).find(Boolean)
        if (hit) {
          strong = true
          marker = hit
          strongDepth = depth
        }
      }
    }

    node = node.parentElement
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

/**
 * Nearby text used to tell "published" from "updated". Looks at the element,
 * its parent, and the text immediately preceding it.
 */
export function surroundingText(el: Element): string {
  const own = el.textContent ?? ''
  const parent = el.parentElement?.textContent ?? ''
  const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? ''
  return `${label} ${parent} ${own}`.slice(0, 400)
}
