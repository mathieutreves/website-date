import type { Candidate, Env } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'

/**
 * RSS/Atom feed lookup — the signal that makes undated static-site posts
 * solvable.
 *
 * Hugo, Astro, Jekyll and Eleventy all emit a feed by default, and Atom entries
 * carry `<published>` and `<updated>` as separate elements. That makes this a
 * site-*declared* signal available on exactly the personal blogs where inline
 * metadata is absent. See docs/DESIGN.md §4.4.
 */

/** Probed only when the document declares no feed. Kept short — each is a request. */
const WELL_KNOWN_PATHS = ['/index.xml', '/feed.xml', '/rss.xml', '/atom.xml', '/feed/']
const MAX_PROBES = 2

export async function extractFeed(
  doc: Document,
  pageUrl: URL,
  env: Env,
  opts: ParseOptions = {},
): Promise<Candidate[]> {
  const fetchText = env.fetchText
  const parseXml = env.parseXml ?? defaultParseXml
  if (!fetchText) return []

  const declared = declaredFeedUrls(doc, pageUrl)
  const probes = declared.length > 0 ? [] : wellKnownUrls(pageUrl).slice(0, MAX_PROBES)

  for (const feedUrl of [...declared, ...probes]) {
    let xml: string | null
    try {
      xml = await fetchText(feedUrl)
    } catch {
      continue
    }
    if (!xml) continue

    const feedDoc = parseXml(xml)
    if (!feedDoc) continue

    const found = readEntry(feedDoc, pageUrl, canonicalUrl(doc, pageUrl), opts, declared.length > 0)
    if (found.length > 0) return found
  }

  return []
}

/** Feeds the page itself points at. */
function declaredFeedUrls(doc: Document, pageUrl: URL): string[] {
  const out: string[] = []
  const links = doc.querySelectorAll(
    'link[rel~="alternate"][type="application/rss+xml"], link[rel~="alternate"][type="application/atom+xml"]',
  )

  for (const link of links) {
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

function canonicalUrl(doc: Document, pageUrl: URL): string | null {
  const href = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')
  if (!href) return null
  try {
    return new URL(href, pageUrl).toString()
  } catch {
    return null
  }
}

/** Find the entry matching this page and read its dates. */
function readEntry(
  feedDoc: Document,
  pageUrl: URL,
  canonical: string | null,
  opts: ParseOptions,
  wasDeclared: boolean,
): Candidate[] {
  const entries = [
    ...Array.from(feedDoc.querySelectorAll('entry')),
    ...Array.from(feedDoc.querySelectorAll('item')),
  ]

  const targets = [pageUrl.toString(), canonical].filter((v): v is string => Boolean(v))

  for (const entry of entries) {
    if (!matchesEntry(entry, targets, pageUrl)) continue

    const out: Candidate[] = []
    const isAtom = entry.tagName?.toLowerCase() === 'entry'
    const source = isAtom ? 'atom-feed' : 'rss-feed'
    const note = `${isAtom ? 'Atom' : 'RSS'} feed entry${wasDeclared ? '' : ' (probed)'}`

    // Atom distinguishes the two; RSS only carries a publication date.
    for (const [tag, field] of [
      ['published', 'published'],
      ['pubDate', 'published'],
      ['updated', 'modified'],
    ] as const) {
      const raw = childText(entry, tag)
      if (!raw) continue
      const parsed = parseDateString(raw, opts)
      if (!parsed) continue
      out.push({ ...parsed, field, source, confidence: 'declared', note })
    }

    // An Atom entry with only <updated> is stating a publication date for a
    // post that has never been revised — treating it as a modification would
    // invent an edit history that doesn't exist.
    if (out.length === 1 && out[0]?.field === 'modified' && isAtom) {
      return [{ ...out[0], field: 'published', note: `${note} (only <updated> present)` }]
    }

    if (out.length > 0) return out
  }

  return []
}

function matchesEntry(entry: Element, targets: string[], pageUrl: URL): boolean {
  const hrefs = entryLinks(entry)
  if (hrefs.length === 0) return false

  // Exact, then canonical, then path-only — query strings and tracking
  // parameters differ constantly between a feed and the page it points at.
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

function entryLinks(entry: Element): string[] {
  const out: string[] = []

  for (const link of entry.querySelectorAll('link')) {
    const rel = link.getAttribute('rel')
    if (rel && rel !== 'alternate') continue
    // Atom puts the URL in @href; RSS puts it in the element's text.
    const href = link.getAttribute('href') ?? link.textContent?.trim()
    if (href) out.push(href)
  }

  const guid = childText(entry, 'guid')
  if (guid?.startsWith('http')) out.push(guid)

  return out
}

const normalisePath = (path: string): string => path.replace(/\/+$/, '').toLowerCase() || '/'

/** Direct child by local name, ignoring namespace prefixes. */
function childText(parent: Element, localName: string): string | undefined {
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

function defaultParseXml(xml: string): Document | null {
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
