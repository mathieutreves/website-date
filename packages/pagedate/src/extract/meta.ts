import type { Candidate, Confidence, Field } from '../types.js'
import { parseDateString, type ParseOptions } from '../parse/normalize.js'

type MetaRule = {
  /** Matched case-insensitively against `property`, `name` or `itemprop`. */
  key: string
  field: Field
  confidence: Confidence
  source: string
}

/**
 * OpenGraph and friends. `declared` entries are ones the site set deliberately
 * for machine consumption; `derived` ones are weaker conventions that CMSes
 * often emit as a build artefact rather than a considered value.
 */
const RULES: MetaRule[] = [
  // OpenGraph — deliberate, widely used, rarely wrong.
  { key: 'article:published_time', field: 'published', confidence: 'declared', source: 'opengraph' },
  { key: 'article:modified_time', field: 'modified', confidence: 'declared', source: 'opengraph' },
  { key: 'og:updated_time', field: 'modified', confidence: 'declared', source: 'opengraph' },

  // Microdata mirrors of the schema.org vocabulary.
  { key: 'datepublished', field: 'published', confidence: 'declared', source: 'itemprop' },
  { key: 'datemodified', field: 'modified', confidence: 'declared', source: 'itemprop' },

  // Dublin Core.
  { key: 'dc.date.issued', field: 'published', confidence: 'derived', source: 'dublin-core' },
  { key: 'dcterms.issued', field: 'published', confidence: 'derived', source: 'dublin-core' },
  { key: 'dc.date.created', field: 'published', confidence: 'derived', source: 'dublin-core' },
  { key: 'dc.date.modified', field: 'modified', confidence: 'derived', source: 'dublin-core' },
  { key: 'dcterms.modified', field: 'modified', confidence: 'derived', source: 'dublin-core' },
  { key: 'dc.date', field: 'unknown', confidence: 'derived', source: 'dublin-core' },

  // Scholarly / news conventions.
  { key: 'citation_publication_date', field: 'published', confidence: 'derived', source: 'citation' },
  { key: 'citation_date', field: 'published', confidence: 'derived', source: 'citation' },
  { key: 'parsely-pub-date', field: 'published', confidence: 'derived', source: 'parsely' },
  { key: 'sailthru.date', field: 'published', confidence: 'derived', source: 'sailthru' },

  // Generic, and generically unreliable — plenty of CMSes emit build time here.
  { key: 'date', field: 'unknown', confidence: 'derived', source: 'meta-date' },
  { key: 'pubdate', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'publishdate', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'last-modified', field: 'modified', confidence: 'derived', source: 'meta-date' },
  { key: 'lastmod', field: 'modified', confidence: 'derived', source: 'meta-date' },
]

const RULE_BY_KEY = new Map(RULES.map((r) => [r.key, r]))

export function extractMeta(doc: Document, opts: ParseOptions = {}): Candidate[] {
  const out: Candidate[] = []

  for (const el of doc.querySelectorAll('meta')) {
    const key = (
      el.getAttribute('property') ??
      el.getAttribute('name') ??
      el.getAttribute('itemprop') ??
      ''
    )
      .trim()
      .toLowerCase()
    if (!key) continue

    const rule = RULE_BY_KEY.get(key)
    if (!rule) continue

    const raw = el.getAttribute('content')?.trim()
    if (!raw) continue

    const parsed = parseDateString(raw, opts)
    if (!parsed) continue

    out.push({
      ...parsed,
      field: rule.field,
      source: rule.source,
      confidence: rule.confidence,
      note: `<meta> ${key}`,
    })
  }

  return out
}
