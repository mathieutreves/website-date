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

/**
 * Vendor-namespaced meta properties that name a date.
 *
 * Sites invent their own: 500px declares `five_hundred_pixels:uploaded`, and
 * plenty of CMSes emit `<publisher>:published_at`. The namespace is
 * unguessable but the last segment is not, so the property is matched on its
 * tail rather than enumerated.
 */
const VENDOR_DATE_KEY =
  /(?:^|[:._-])(published?|published_?at|publish_?date|uploaded|upload_?date|created_?at|release_?date|pubdate|date)$/i

const VENDOR_MODIFIED_KEY = /(?:^|[:._-])(modified|modified_?at|updated|updated_?at|lastmod)$/i

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

    let rule = RULE_BY_KEY.get(key)

    // Fall back to the property's own wording. Only namespaced keys qualify:
    // a bare `date` is already handled above, and matching every unprefixed
    // property that ends in a date-ish word invites noise.
    if (!rule && key.includes(':')) {
      if (VENDOR_MODIFIED_KEY.test(key)) {
        rule = { key, field: 'modified', confidence: 'derived', source: 'meta-date' }
      } else if (VENDOR_DATE_KEY.test(key)) {
        rule = { key, field: 'published', confidence: 'derived', source: 'meta-date' }
      }
    }
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
