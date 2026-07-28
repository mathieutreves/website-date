import type { Candidate, Env } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'
import { canonicalUrl, childText, defaultParseXml, matchesPage } from './xml.js'

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
  return matchesPage(entryLinks(entry), targets, pageUrl)
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
