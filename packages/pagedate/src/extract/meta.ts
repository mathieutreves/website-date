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
  // OpenGraph — deliberate, widely used, rarely wrong. `article:` is the
  // namespace the spec defines; the `og:` forms are what a good many CMSes
  // emit instead, and they are the same statement.
  { key: 'article:published_time', field: 'published', confidence: 'declared', source: 'opengraph' },
  { key: 'article:modified_time', field: 'modified', confidence: 'declared', source: 'opengraph' },
  { key: 'og:updated_time', field: 'modified', confidence: 'declared', source: 'opengraph' },
  { key: 'og:published_time', field: 'published', confidence: 'declared', source: 'opengraph' },
  { key: 'og:article:published_time', field: 'published', confidence: 'declared', source: 'opengraph' },
  { key: 'og:modified_time', field: 'modified', confidence: 'declared', source: 'opengraph' },
  { key: 'og:article:modified_time', field: 'modified', confidence: 'declared', source: 'opengraph' },

  // Microdata mirrors of the schema.org vocabulary.
  { key: 'datepublished', field: 'published', confidence: 'declared', source: 'itemprop' },
  { key: 'datemodified', field: 'modified', confidence: 'declared', source: 'itemprop' },

  // Dublin Core. Both the `dc.`/`dcterms.` spellings and the `dc:` one, which
  // is what a site emitting RDFa-flavoured metadata writes.
  { key: 'dc.date.issued', field: 'published', confidence: 'derived', source: 'dublin-core' },
  { key: 'dcterms.issued', field: 'published', confidence: 'derived', source: 'dublin-core' },
  { key: 'dc.date.created', field: 'published', confidence: 'derived', source: 'dublin-core' },
  { key: 'dc.date.publication', field: 'published', confidence: 'derived', source: 'dublin-core' },
  { key: 'dc.created', field: 'published', confidence: 'derived', source: 'dublin-core' },
  { key: 'dc:created', field: 'published', confidence: 'derived', source: 'dublin-core' },
  { key: 'dcterms.created', field: 'published', confidence: 'derived', source: 'dublin-core' },
  { key: 'dc.date.modified', field: 'modified', confidence: 'derived', source: 'dublin-core' },
  { key: 'dcterms.modified', field: 'modified', confidence: 'derived', source: 'dublin-core' },
  { key: 'dc.modified', field: 'modified', confidence: 'derived', source: 'dublin-core' },
  { key: 'dc.date', field: 'unknown', confidence: 'derived', source: 'dublin-core' },
  { key: 'dc:date', field: 'unknown', confidence: 'derived', source: 'dublin-core' },
  { key: 'dcterms.date', field: 'unknown', confidence: 'derived', source: 'dublin-core' },

  // Scholarly / news conventions.
  { key: 'citation_publication_date', field: 'published', confidence: 'derived', source: 'citation' },
  { key: 'citation_date', field: 'published', confidence: 'derived', source: 'citation' },
  { key: 'parsely-pub-date', field: 'published', confidence: 'derived', source: 'parsely' },
  { key: 'sailthru.date', field: 'published', confidence: 'derived', source: 'sailthru' },

  // Generic, and generically unreliable — plenty of CMSes emit build time here.
  //
  // Unprefixed keys have to be enumerated rather than pattern-matched: the
  // vendor tails below deliberately require a namespace, because matching every
  // bare property that ends in a date-ish word invites noise. Every spelling
  // here is one a real CMS emits; the list tracks htmldate's, which was
  // collected the same way.
  { key: 'date', field: 'unknown', confidence: 'derived', source: 'meta-date' },
  { key: 'pubdate', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'publishdate', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'publisheddate', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'publication_date', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'publish-date', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'publish_date', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'publish_time', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'published-date', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'published_date', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'published_time', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'date_published', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'date_created', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'datecreated', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'dateposted', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'article.created', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'article.published', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'article_date_original', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'content_create_date', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'originalpublicationdate', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'displaydate', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'doc_date', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'field-name-post-date', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'gentime', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'release_date', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'rbpubdate', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'pdate', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'ptime', field: 'published', confidence: 'derived', source: 'meta-date' },
  { key: 'last-modified', field: 'modified', confidence: 'derived', source: 'meta-date' },
  { key: 'lastmod', field: 'modified', confidence: 'derived', source: 'meta-date' },
  { key: 'lastmodified', field: 'modified', confidence: 'derived', source: 'meta-date' },
  { key: 'lastdate', field: 'modified', confidence: 'derived', source: 'meta-date' },
  { key: 'modified', field: 'modified', confidence: 'derived', source: 'meta-date' },
  { key: 'modified_time', field: 'modified', confidence: 'derived', source: 'meta-date' },
  { key: 'modificationdate', field: 'modified', confidence: 'derived', source: 'meta-date' },
  { key: 'updated_time', field: 'modified', confidence: 'derived', source: 'meta-date' },
  { key: 'revision_date', field: 'modified', confidence: 'derived', source: 'meta-date' },
  { key: 'utime', field: 'modified', confidence: 'derived', source: 'meta-date' },
]

const RULE_BY_KEY = new Map(RULES.map((r) => [r.key, r]))

/**
 * Vendor-namespaced meta properties that name a date.
 *
 * Sites invent their own: 500px declares `five_hundred_pixels:uploaded`, and
 * plenty of CMSes emit `<publisher>:published_at`. The namespace is
 * unguessable but the last segment is not, so the property is matched on its
 * tail rather than enumerated.
 *
 * `time` is accepted alongside `date` because the OpenGraph-shaped spellings a
 * CMS reaches for — `og:published_time`, `shareaholic:article_published_time`,
 * `cxenseparse:recs:publishtime` — all end that way, and a tail list without it
 * matches none of them.
 */
const VENDOR_DATE_KEY =
  /(?:^|[:._-])(published?|publication|published_?at|publish(?:ed)?_?(?:date|time)|publishtime|date_?published|uploaded|upload_?date|created_?at|release_?date|pubdate|date)$/i

const VENDOR_MODIFIED_KEY =
  /(?:^|[:._-])(modified|modified_?at|modified_?(?:date|time)|moddate|modificationdate|date_?modified|updated|updated_?at|updated_?(?:date|time)|revision_?date|lastmod)$/i

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
