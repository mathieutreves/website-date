import type { Candidate } from '../types.js'
import { parseDateString } from '../parse/normalize.js'
import type { ParseOptions } from '../parse/normalize.js'

/**
 * Types that describe the *content*, ranked above container types like
 * `WebPage`. A page carrying both usually has the accurate date on the Article
 * and the site build date on the WebPage.
 */
const ARTICLE_TYPES = new Set([
  'article',
  'blogposting',
  'newsarticle',
  'techarticle',
  'scholarlyarticle',
  'report',
  'socialmediaposting',
  'liveblogposting',
  'question',
  'webpageelement',
])

type JsonValue = unknown

function typesOf(node: Record<string, JsonValue>): string[] {
  const raw = node['@type']
  const list = Array.isArray(raw) ? raw : [raw]
  return list.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase())
}

/**
 * Walk every object in the graph. Publishers nest the useful node arbitrarily
 * deep — inside `@graph`, `mainEntity`, `itemListElement`, or a bare array — so
 * a full recursive walk is more reliable than probing known paths.
 */
function* walk(value: JsonValue, depth = 0): Generator<Record<string, JsonValue>> {
  if (depth > 12 || value === null || typeof value !== 'object') return

  if (Array.isArray(value)) {
    for (const item of value) yield* walk(item, depth + 1)
    return
  }

  const node = value as Record<string, JsonValue>
  yield node
  for (const key of Object.keys(node)) {
    if (key.startsWith('@') && key !== '@graph') continue
    yield* walk(node[key], depth + 1)
  }
}

/**
 * `datePublished` may be a plain string or a nested `{ "@value": "..." }`.
 */
function readDate(node: Record<string, JsonValue>, key: string): string | undefined {
  const raw = node[key]
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const inner = (raw as Record<string, JsonValue>)['@value']
    if (typeof inner === 'string') return inner
  }
  if (Array.isArray(raw)) {
    const first = raw.find((v) => typeof v === 'string')
    if (typeof first === 'string') return first
  }
  return undefined
}

export function extractJsonLd(doc: Document, opts: ParseOptions = {}): Candidate[] {
  const out: Candidate[] = []
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]')

  for (const script of scripts) {
    const text = script.textContent?.trim()
    if (!text) continue

    let parsed: JsonValue
    try {
      parsed = JSON.parse(text)
    } catch {
      // Malformed JSON-LD is common enough that it isn't worth reporting.
      continue
    }

    for (const node of walk(parsed)) {
      const types = typesOf(node)
      const isArticle = types.some((t) => ARTICLE_TYPES.has(t))
      // Only trust dates on nodes that declare a type; an untyped object with a
      // `datePublished` key is usually a fragment we've walked into by accident.
      if (types.length === 0) continue

      for (const [key, field] of [
        ['datePublished', 'published'],
        ['dateCreated', 'published'],
        ['dateModified', 'modified'],
        ['uploadDate', 'published'],
      ] as const) {
        const raw = readDate(node, key)
        if (!raw) continue
        const parsedDate = parseDateString(raw, opts)
        if (!parsedDate) continue

        out.push({
          ...parsedDate,
          field,
          // Container types rank below content types: a page carrying both
          // usually has the real date on the Article and the site build time
          // on the WebPage. Distinguishing them by source rather than by a
          // note means ranking can actually act on it.
          source: isArticle ? 'jsonld' : 'jsonld-container',
          confidence: 'declared',
          note: `schema.org ${key} on ${types[0] ?? 'node'}${isArticle ? '' : ' (container type)'}`,
        })
      }
    }
  }

  return out
}
