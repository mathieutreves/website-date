/**
 * Shared plumbing for the documents a site publishes *about* its pages rather
 * than inside them — feeds and sitemaps. Both are XML fetched from a second
 * URL, both are matched back to the page by `<loc>`/`<link>`, and neither can
 * assume a namespace prefix.
 */

import type { Env } from '../types.js'

/**
 * Parse XML with the platform parser.
 *
 * The library never depends on one: browsers and service workers have
 * `DOMParser`, Node callers inject one through {@link Env.parseXml}. Absent
 * both, the XML paths simply do not run.
 */
export function defaultParseXml(xml: string): Document | null {
  const Parser = (globalThis as { DOMParser?: new () => DOMParser }).DOMParser
  if (!Parser) return null
  try {
    const parsed = new Parser().parseFromString(xml, 'application/xml')
    // A parse error yields a document whose root is <parsererror>.
    if (parsed.querySelector('parsererror')) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Is there anything to parse a feed or sitemap with?
 *
 * Asked before fetching one. Without a parser the response can only be thrown
 * away, and a request whose answer is discarded is still a request to somebody
 * else's server.
 */
export function canParseXml(env: Env): boolean {
  return env.parseXml !== undefined || (globalThis as { DOMParser?: unknown }).DOMParser !== undefined
}

/** Direct child by local name, ignoring namespace prefixes. */
export function childText(parent: Element, localName: string): string | undefined {
  const wanted = localName.toLowerCase()
  for (const child of parent.children) {
    const name = (child.tagName ?? '').toLowerCase().replace(/^.*:/, '')
    if (name === wanted) {
      const text = child.textContent?.trim()
      if (text) return text
    }
  }
  return undefined
}

/**
 * Trailing slashes and case are not meaningful differences between the URL a
 * page is served at and the one the site lists it under.
 */
export const normalisePath = (path: string): string => path.replace(/\/+$/, '').toLowerCase() || '/'

/** The URL the page says it really lives at, if it says. */
export function canonicalUrl(doc: Document, pageUrl: URL): string | null {
  const href = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')
  if (!href) return null
  try {
    return new URL(href, pageUrl).toString()
  } catch {
    return null
  }
}

/**
 * Does one of `hrefs` point at this page?
 *
 * Exact, then canonical, then a looser comparison, because a side document
 * and the page it points at routinely differ in scheme, `www.`, a trailing slash
 * and tracking parameters.
 *
 * The looser comparison still requires the same site and the same query once
 * tracking parameters are set aside. Comparing the path alone made every
 * `story.php?id=…` and `/?p=…` page match the first entry of its own feed —
 * same path, different story — and handed it that entry's date at `declared`
 * confidence.
 */
export function matchesPage(hrefs: string[], targets: string[], pageUrl: URL): boolean {
  if (hrefs.length === 0) return false

  for (const target of targets) {
    if (hrefs.some((h) => h === target)) return true
  }

  const target = looseKey(pageUrl)
  return hrefs.some((h) => {
    try {
      return looseKey(new URL(h, pageUrl)) === target
    } catch {
      return false
    }
  })
}

/** Parameters that say where a visit came from, not which page it is. */
const TRACKING_PARAM = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_[ce]id|igshid|ref|ref_src|source|cmpid|ocid|amp)$/i

/** A URL reduced to what identifies the page: site, path, meaningful query. */
function looseKey(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const query = [...url.searchParams]
    .filter(([name]) => !TRACKING_PARAM.test(name))
    .map(([name, value]) => `${name}=${value}`)
    .sort()
    .join('&')
  return `${host}${normalisePath(url.pathname)}?${query}`
}
