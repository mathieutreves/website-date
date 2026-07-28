import { describe, expect, it } from 'vitest'
import { extractFromDocument } from '../src/index.js'
import { extractJsonLd } from '../src/extract/jsonld.js'
import { extractUrlSlug } from '../src/extract/urlSlug.js'
import { documentFrom } from './helpers.js'

const find = (
  candidates: ReturnType<typeof extractFromDocument>,
  source: string,
  field?: string,
) => candidates.filter((c) => c.source === source && (!field || c.field === field))

describe('JSON-LD', () => {
  it('finds dates nested inside @graph', () => {
    const doc = documentFrom(`
      <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","name":"Example"},
        {"@type":"BlogPosting","datePublished":"2023-04-11","dateModified":"2024-09-02"}
      ]}
      </script>`)

    const found = extractJsonLd(doc)
    expect(found.find((c) => c.field === 'published')?.value).toBe('2023-04-11')
    expect(found.find((c) => c.field === 'modified')?.value).toBe('2024-09-02')
    expect(found.every((c) => c.confidence === 'declared')).toBe(true)
  })

  it('marks container types so ranking can prefer article-scoped dates', () => {
    const doc = documentFrom(`
      <script type="application/ld+json">
      {"@type":"WebPage","datePublished":"2020-01-01"}
      </script>`)

    expect(extractJsonLd(doc)[0]?.note).toContain('container type')
  })

  it('reads the {"@value": ...} form', () => {
    const doc = documentFrom(`
      <script type="application/ld+json">
      {"@type":"Article","datePublished":{"@value":"2022-06-01"}}
      </script>`)

    expect(extractJsonLd(doc)[0]?.value).toBe('2022-06-01')
  })

  it('skips malformed JSON without throwing', () => {
    const doc = documentFrom(`<script type="application/ld+json">{ not json </script>`)
    expect(extractJsonLd(doc)).toEqual([])
  })
})

describe('meta tags', () => {
  it('reads OpenGraph as declared', () => {
    const doc = documentFrom(`
      <meta property="article:published_time" content="2023-04-11T10:00:00Z">
      <meta property="article:modified_time" content="2024-09-02T08:30:00Z">`)

    const found = extractFromDocument(doc, 'https://example.com/post')
    expect(find(found, 'opengraph', 'published')[0]?.value).toBe('2023-04-11T10:00Z')
    expect(find(found, 'opengraph', 'modified')[0]?.value).toBe('2024-09-02T08:30Z')
    expect(find(found, 'opengraph')[0]?.confidence).toBe('declared')
  })

  it('reads Dublin Core as derived, not declared', () => {
    const doc = documentFrom(`<meta name="DC.date.issued" content="2019-05-04">`)
    const found = extractFromDocument(doc, 'https://example.com/post')
    expect(find(found, 'dublin-core')[0]).toMatchObject({
      value: '2019-05-04',
      confidence: 'derived',
    })
  })
})

describe('<time> context filtering', () => {
  it('takes the article byline and ignores the sidebar', () => {
    const doc = documentFrom(`
      <article>
        <header class="post-meta">
          Published <time datetime="2023-04-11">11 April 2023</time>
        </header>
      </article>
      <aside class="related-posts">
        <time datetime="2026-01-01">1 January 2026</time>
      </aside>`)

    const found = find(extractFromDocument(doc, 'https://example.com/post'), 'time-tag')
    expect(found).toHaveLength(1)
    expect(found[0]?.value).toBe('2023-04-11')
  })

  it('discards a "recent posts" list even outside <aside>', () => {
    const doc = documentFrom(`
      <div class="recent-posts">
        <time datetime="2026-01-01">1 January 2026</time>
      </div>`)

    expect(find(extractFromDocument(doc, 'https://example.com/post'), 'time-tag')).toHaveLength(0)
  })

  it('labels the field from surrounding wording', () => {
    const doc = documentFrom(`
      <article><p>Last updated <time datetime="2024-09-02">2 Sep 2024</time></p></article>`)

    expect(find(extractFromDocument(doc, 'https://example.com/post'), 'time-tag')[0]?.field).toBe(
      'modified',
    )
  })
})

describe('visible text', () => {
  it('reads an Italian update line', () => {
    const doc = documentFrom(`
      <article><p class="meta">Ultimo aggiornamento: 3 dicembre 2021</p></article>`)

    const found = find(extractFromDocument(doc, 'https://example.it/articolo'), 'visible-text')
    expect(found[0]).toMatchObject({
      value: '2021-12-03',
      field: 'modified',
      confidence: 'inferred',
    })
  })

  it('requires a label — bare dates in prose are ignored', () => {
    const doc = documentFrom(`
      <article><p>The conference took place on 3 December 2021 in Rome.</p></article>`)

    expect(
      find(extractFromDocument(doc, 'https://example.com/post'), 'visible-text'),
    ).toHaveLength(0)
  })
})

describe('URL slug', () => {
  it('reads a full date path', () => {
    expect(extractUrlSlug(new URL('https://example.com/2024/03/12/hello'))[0]).toMatchObject({
      value: '2024-03-12',
      precision: 'day',
      confidence: 'inferred',
    })
  })

  it('falls back to month precision', () => {
    expect(extractUrlSlug(new URL('https://example.com/2024/03/hello'))[0]).toMatchObject({
      value: '2024-03',
      precision: 'month',
    })
  })

  it('ignores number runs that are not dates', () => {
    expect(extractUrlSlug(new URL('https://example.com/1234/99/88/x'))).toEqual([])
  })
})

describe('locale wiring', () => {
  it('uses the document language to disambiguate numeric dates', () => {
    const doc = documentFrom(`
      <html lang="it"><body>
        <article><p>Pubblicato il 03/04/2024</p></article>
      </body></html>`)

    const found = find(extractFromDocument(doc, 'https://example.it/articolo'), 'visible-text')
    // Italian is day-first: 3 April, not 4 March.
    expect(found[0]?.value).toBe('2024-04-03')
  })
})
