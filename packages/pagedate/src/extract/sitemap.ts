import type { Candidate, Env } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'
import { canonicalUrl, childText, defaultParseXml, matchesPage, normalisePath } from './xml.js'

/**
 * `<lastmod>` from the site's own sitemap.
 *
 * The sitemap is the one place a site states a date about a page without
 * putting it on the page, which makes it available on exactly the documentation
 * and static-site pages that carry no inline metadata and no feed entry.
 *
 * It says `modified`, not `published`, because that is what `<lastmod>` is
 * defined as — the last time the file changed. On a page never edited the two
 * coincide, but inventing a publication date out of a modification date is the
 * inference this library exists to avoid. It sits in the `derived` tier because
 * a good many generators stamp every entry with the build time.
 */

/** Probed in order, and only when the page declares no sitemap of its own. */
const WELL_KNOWN_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml']

/**
 * Total documents fetched per page, index children included.
 *
 * A sitemap index on a large site names hundreds of children and only one of
 * them holds the page. Chasing them all would cost more requests than the
 * signal is worth, so the budget is small and the children are tried in
 * best-guess order.
 */
const MAX_FETCHES = 3

export async function extractSitemap(
  doc: Document,
  pageUrl: URL,
  env: Env,
  opts: ParseOptions = {},
): Promise<Candidate[]> {
  const fetchText = env.fetchText
  const parseXml = env.parseXml ?? defaultParseXml
  if (!fetchText) return []

  const targets = [pageUrl.toString(), canonicalUrl(doc, pageUrl)].filter(
    (v): v is string => Boolean(v),
  )

  const declared = declaredSitemapUrls(doc, pageUrl)
  const queue = declared.length > 0 ? declared : wellKnownUrls(pageUrl)
  const seen = new Set<string>()
  let fetches = 0

  while (queue.length > 0 && fetches < MAX_FETCHES) {
    const url = queue.shift()!
    if (seen.has(url)) continue
    seen.add(url)
    fetches++

    let xml: string | null
    try {
      xml = await fetchText(url)
    } catch {
      continue
    }
    if (!xml) continue

    const sitemapDoc = parseXml(xml)
    if (!sitemapDoc) continue

    const found = readUrlset(sitemapDoc, targets, pageUrl, opts, url)
    if (found) return [found]

    // Not the page's own sitemap, but it may name the one that is. Children go
    // to the front of the queue: a sitemap index that pointed us at a
    // likely-looking child is better evidence than the next blind well-known
    // guess.
    queue.unshift(...indexChildren(sitemapDoc, pageUrl).filter((child) => !seen.has(child)))
  }

  return []
}

/** Sitemaps the page itself points at. */
function declaredSitemapUrls(doc: Document, pageUrl: URL): string[] {
  const out: string[] = []
  for (const link of doc.querySelectorAll('link[rel~="sitemap"]')) {
    const href = link.getAttribute('href')
    if (!href) continue
    try {
      out.push(new URL(href, pageUrl).toString())
    } catch {
      // relative href we can't resolve — skip
    }
  }
  return out
}

function wellKnownUrls(pageUrl: URL): string[] {
  const out: string[] = []
  for (const path of WELL_KNOWN_PATHS) {
    try {
      out.push(new URL(path, pageUrl.origin).toString())
    } catch {
      // ignore
    }
  }
  return out
}

/**
 * Enough entries to tell a generator's build stamp from a page's own date.
 *
 * A handful of pages can legitimately share a `<lastmod>` — a small site
 * published in one sitting does. A hundred cannot.
 */
const BUILD_STAMP_MIN_ENTRIES = 10

/** Find this page's `<url>` entry and read its `<lastmod>`. */
function readUrlset(
  sitemapDoc: Document,
  targets: string[],
  pageUrl: URL,
  opts: ParseOptions,
  sitemapUrl: string,
): Candidate | null {
  const entries = Array.from(sitemapDoc.querySelectorAll('url'))

  // A sitemap where every page changed at the same instant is reporting when
  // the site was generated, which is a fact about the build server and not
  // about any page in it. Hugo and Jekyll both emit this by default.
  if (isBuildStamped(entries)) return null

  for (const entry of entries) {
    const loc = childText(entry, 'loc')
    if (!loc) continue
    if (!matchesPage([loc], targets, pageUrl)) continue

    const raw = childText(entry, 'lastmod')
    if (!raw) continue
    const parsed = parseDateString(raw, opts)
    if (!parsed) continue

    return {
      ...parsed,
      field: 'modified',
      source: 'sitemap',
      confidence: 'derived',
      note: `<lastmod> in ${shortUrl(sitemapUrl)}`,
    }
  }

  return null
}

function isBuildStamped(entries: Element[]): boolean {
  if (entries.length < BUILD_STAMP_MIN_ENTRIES) return false

  let first: string | undefined
  for (const entry of entries) {
    const lastmod = childText(entry, 'lastmod')
    if (!lastmod) continue
    if (first === undefined) first = lastmod
    else if (lastmod !== first) return false
  }

  return first !== undefined
}

/**
 * Children of a sitemap index, likeliest first.
 *
 * "Likeliest" is the child whose path shares the most with the page's own — a
 * post at `/blog/2024/thing` is far more often listed in `post-sitemap.xml` or
 * `/blog/sitemap.xml` than in the first child alphabetically.
 */
function indexChildren(sitemapDoc: Document, pageUrl: URL): string[] {
  const children: string[] = []

  for (const entry of sitemapDoc.querySelectorAll('sitemap')) {
    const loc = childText(entry, 'loc')
    if (!loc) continue
    // Gzipped children are the common large-site case and we have no unzip:
    // fetching one buys a parse failure at the price of a request.
    if (/\.gz(?:\?|$)/i.test(loc)) continue
    try {
      children.push(new URL(loc, pageUrl).toString())
    } catch {
      // ignore
    }
  }

  const pagePath = normalisePath(pageUrl.pathname)
  return children.sort((a, b) => affinity(b, pagePath) - affinity(a, pagePath))
}

/** Length of the leading path substring a child sitemap shares with the page. */
function affinity(childUrl: string, pagePath: string): number {
  let childPath: string
  try {
    childPath = normalisePath(new URL(childUrl).pathname)
  } catch {
    return 0
  }

  let shared = 0
  while (shared < childPath.length && shared < pagePath.length) {
    if (childPath[shared] !== pagePath[shared]) break
    shared++
  }
  return shared
}

/** Sitemap URLs are long and the note has one line. Host plus filename is enough. */
function shortUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const file = parsed.pathname.split('/').filter(Boolean).pop() ?? parsed.pathname
    return `${parsed.host}/${file}`
  } catch {
    return url
  }
}
