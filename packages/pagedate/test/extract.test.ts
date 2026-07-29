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

describe('reading a class name for what it says', () => {
  it('takes the most specific vocabulary word in a class, not the leftmost', () => {
    // Meduza's date block. `meta` says "metadata lives here" and `time` says
    // "and it is a date"; position in the string means nothing, specificity does.
    const doc = documentFrom(`
      <html lang="ru"><body><article>
        <div class="MaterialMeta MaterialMeta--time">06:00, 21 сентября 2018</div>
        <p>Текст статьи.</p>
      </article></body></html>`)

    const found = find(extractFromDocument(doc, 'https://meduza.io/feature/x'), 'marked-date')
    expect(found[0]?.value).toBe('2018-09-21')
  })

  it('still reports the generic marker when that is all the class says', () => {
    const doc = documentFrom(`
      <html lang="en"><body><article>
        <div class="entry-meta">Some text 2018</div>
        <p>Body.</p>
      </article></body></html>`)

    // `entry-meta` is a reason to look, not an assertion that this is the date.
    expect(find(extractFromDocument(doc, 'https://example.com/p'), 'marked-date')).toHaveLength(0)
  })
})

describe('a date followed by the word "published"', () => {
  it('is a byline when the markup says the element is one', () => {
    const doc = documentFrom(`
      <html lang="de"><body><article>
        <p class="entry-meta">Dieser Artikel wurde am 14. Dezember 2015 veröffentlicht</p>
        <p>Fließtext.</p>
      </article></body></html>`)

    const found = find(extractFromDocument(doc, 'https://example.de/artikel'), 'visible-text')
    expect(found[0]?.value).toBe('2015-12-14')
    expect(found[0]?.field).toBe('published')
  })

  it('is a sentence when it is not', () => {
    // Daring Fireball, quoting a report. Read as a byline this dated the page
    // two and a half years early.
    const doc = documentFrom(`
      <html lang="en"><body><div id="Main"><dl class="linkedlist"><dd>
        <p>Bloomberg’s Michael Riley, on 5 October 2018, just after the original
        report was published:</p>
      </dd></dl></div></body></html>`)

    const found = extractFromDocument(doc, 'https://daringfireball.net/linked/x')
    expect(found.some((c) => c.value.startsWith('2018-10-05'))).toBe(false)
  })
})

describe('<aside> is furniture only outside an article', () => {
  it('reads a metadata block an article keeps in its own <aside>', () => {
    // ebene11.com. A blanket exclusion of <aside> threw away the only date the
    // page has.
    const doc = documentFrom(`
      <html lang="de"><body>
        <article id="content">
          <header><h1>Fremde DWG-Dateien in AutoCAD</h1></header>
          <aside class="blogData"><dl><dt>Datum</dt><dd>12.01.2017</dd></dl></aside>
          <p>Fließtext.</p>
        </article>
      </body></html>`)

    const found = extractFromDocument(doc, 'https://ebene11.com/autocad', { mode: 'extensive' })
    expect(found.some((c) => c.value === '2017-01-12')).toBe(true)
  })

  it('still ignores a page-level sidebar', () => {
    const doc = documentFrom(`
      <html lang="en"><body>
        <main><p>Body with no date.</p></main>
        <aside class="recent-posts"><p>3 March 2024</p></aside>
      </body></html>`)

    const found = extractFromDocument(doc, 'https://example.com/p', { mode: 'extensive' })
    expect(found.some((c) => c.value.startsWith('2024-03-03'))).toBe(false)
  })
})

describe('extensive mode: the page-frequency last resort', () => {
  const undatedProse = `
    <html lang="en"><body><main>
      <h1>Notes on build systems</h1>
      <p>Bazel was open-sourced on 21 March 2015, and Buck a year earlier.</p>
      <p>The 2015 release changed how large repos are built.</p>
    </main></body></html>`

  it('answers a page whose only date is buried in prose, with nowhere to look it up', () => {
    // The gap this extractor exists for, and the only one it has to itself:
    // the date is not the element's text, it is a few characters inside a
    // paragraph. `extractBareText` requires the date to carry the element
    // (MIN_DATE_RATIO) and caps the element at 120 characters, so it declines —
    // correctly, on its own terms. Frequency is the only remaining handle.
    const doc = documentFrom(`
      <html lang="de"><body><div id="page"><div class="postcontent">
        <h1>MIDP Emulator und Brick Challenge</h1>
        <p>Ein etwas laengerer Absatz ueber das Projekt, der irgendwo mitten im
        Fliesstext das Datum 15.2.2018 nennt und danach noch weitergeht, ohne dass
        es irgendwo als Byline oder als Datumsblock ausgezeichnet waere.</p>
      </div></div></body></html>`)

    const found = find(extractFromDocument(doc, 'https://blog.example.net/x', { mode: 'extensive' }), 'page-scan')
    expect(found[0]?.value).toBe('2018-02-15')
    expect(found[0]).toMatchObject({ confidence: 'inferred', field: 'unknown' })
  })

  /**
   * The other half of "last resort", and the reason the case above had to be
   * built so carefully: a date in a `<small>` byline is answered by
   * `extractBareText` in standard mode, so `page-scan` must never be reached
   * for it — the gate in `extractFromDocument` is `candidates.length === 0`.
   * A fixture the cheaper extractor already handles tests nothing here.
   */
  it('does not run on a page a cheaper extractor already answered', () => {
    const doc = documentFrom(`
      <html lang="de"><body><div id="page"><div class="postcontent">
        <h1>MIDP Emulator und Brick Challenge</h1>
        <small>Donnerstag, 15.2.2018, 19:51</small>
        <p>Freitext ohne weitere Daten.</p>
      </div></div></body></html>`)

    const all = extractFromDocument(doc, 'https://blog.example.net/x', { mode: 'extensive' })
    expect(find(all, 'page-scan')).toHaveLength(0)
    expect(all.some((c) => c.value === '2018-02-15')).toBe(true)
  })

  /**
   * The exclusion this extractor is most likely to revoke by accident.
   *
   * It runs only when every other extractor declined — which on a page whose
   * only date sits in a sidebar is precisely because they *correctly* excluded
   * that sidebar. Reading every element regardless of position would make this
   * the one extractor that turns a rejected `<aside class="recent-posts">` into
   * the page's publication date. Measured on the htmldate corpus, adding the
   * furniture gate cost nothing (69.1% accuracy either way) and turned one
   * wrong answer into an abstention, 76.0% → 77.6% precision.
   */
  it('respects the furniture exclusions the other extractors apply', () => {
    const doc = documentFrom(`
      <html lang="en"><body>
        <main><p>Body with no date.</p></main>
        <nav><p>Archive for 4 April 2021</p></nav>
        <aside class="recent-posts"><p>3 March 2024</p></aside>
      </body></html>`)

    expect(find(extractFromDocument(doc, 'https://example.com/p', { mode: 'extensive' }), 'page-scan')).toEqual([])
  })

  it('does not run in standard mode', () => {
    const doc = documentFrom(undatedProse)
    expect(find(extractFromDocument(doc, 'https://example.com/x', { mode: 'standard' }), 'page-scan')).toHaveLength(0)
  })

  it('does not run when any other extractor found something', () => {
    const doc = documentFrom(`
      <html lang="en"><body>
        <meta property="article:published_time" content="2023-04-11T10:00:00Z">
        <main><p>Also mentions 1 January 2020 and 1 January 2020 again.</p></main>
      </body></html>`)

    expect(find(extractFromDocument(doc, 'https://example.com/x', { mode: 'extensive' }), 'page-scan')).toHaveLength(0)
  })

  /**
   * The cost, asserted rather than described. `extensive` will date a page that
   * has no date, which is the property `standard` exists to protect and the
   * reason this extractor is not in it. If this test starts failing because the
   * answer became `undefined`, the recall it was added for went with it.
   */
  it('will date an undated page — which is what opting into extensive means', () => {
    const doc = documentFrom(undatedProse)
    const found = find(extractFromDocument(doc, 'https://example.com/x', { mode: 'extensive' }), 'page-scan')
    expect(found).toHaveLength(1)
    expect(found[0]?.confidence).toBe('inferred')

    // And it is filterable, which is the mitigation on offer.
    expect(
      extractFromDocument(doc, 'https://example.com/x', {
        mode: 'extensive',
        minConfidence: 'derived',
      }).some((c) => c.source === 'page-scan'),
    ).toBe(false)
  })
})
