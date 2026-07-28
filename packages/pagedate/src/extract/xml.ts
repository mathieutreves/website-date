/**
 * Shared plumbing for the documents a site publishes *about* its pages rather
 * than inside them — feeds and sitemaps. Both are XML fetched from a second
 * URL, both are matched back to the page by `<loc>`/`<link>`, and neither can
 * assume a namespace prefix.
 */

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
 * Exact, then canonical, then path-only — query strings and tracking parameters
 * differ constantly between a side document and the page it points at.
 */
export function matchesPage(hrefs: string[], targets: string[], pageUrl: URL): boolean {
  if (hrefs.length === 0) return false

  for (const target of targets) {
    if (hrefs.some((h) => h === target)) return true
  }

  const targetPath = normalisePath(pageUrl.pathname)
  return hrefs.some((h) => {
    try {
      return normalisePath(new URL(h, pageUrl).pathname) === targetPath
    } catch {
      return false
    }
  })
}
