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
const ARTICLE_PATTERN = /(^|[-_\s])(byline|dateline|post-meta|entry-meta|article-meta|published|posted-on|pubdate|last-updated|lastmod|updated)([-_\s]|$)/i

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
}

export function scoreContext(el: Element): ContextScore {
  let strong = false
  let sawArticle = false
  let sawHeaderFooter = false
  let node: Element | null = el
  let depth = 0

  // The walk goes child → parent, so `<header>` is always reached before the
  // `<article>` that may contain it. Whether a header counts as furniture
  // therefore can't be decided in the loop — it's deferred until the end.
  while (node && depth < 24) {
    const tag = node.tagName?.toUpperCase()

    if (tag === 'NAV' || tag === 'ASIDE') return { usable: false, strong: false }
    if (tag === 'HEADER' || tag === 'FOOTER') sawHeaderFooter = true
    if (tag === 'ARTICLE' || tag === 'MAIN') sawArticle = true

    const rawMarker = `${node.getAttribute?.('class') ?? ''} ${node.getAttribute?.('id') ?? ''}`
    if (rawMarker.trim()) {
      // Tokenised, so `has-sidebar` and `sidebar` are told apart. Exclusion is
      // matched per token and anchored; the positive hint stays unanchored
      // because a missed hint only reorders, while a wrong exclusion is fatal.
      const tokens = rawMarker.split(/\s+/).filter(Boolean).map(normaliseMarker)
      if (tokens.some((t) => EXCLUDED_PATTERN.test(t))) return { usable: false, strong: false }
      if (tokens.some((t) => ARTICLE_PATTERN.test(t))) strong = true
    }

    node = node.parentElement
    depth++
  }

  // A header or footer nested inside the article is exactly where bylines live;
  // one at page level is site furniture — unless the element itself is marked as
  // a date block. Documentation sites rarely use <article> and put their
  // "Last updated" in a page-level footer, which the plain rule would discard.
  if (sawHeaderFooter && !sawArticle && !strong) return { usable: false, strong: false }

  return { usable: true, strong }
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
