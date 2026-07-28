import { describe, expect, it } from 'vitest'
import { extractFromDocument, extractInlineState, resolveCandidates } from '../src/index.js'
import { documentFrom, NOW } from './helpers.js'

/**
 * The state a page hands its own JavaScript, and the reasons it is read
 * narrowly.
 */
describe('inline state', () => {
  it("reads WordPress's post_date when the markup has no date at all", () => {
    // Boing Boing in 2012: the byline says "at 11:20 am Fri, Nov 2" with no
    // year anywhere, so no amount of text parsing can recover the date.
    const doc = documentFrom(`
      <html><body>
        <article>
          <h1>VUPEN claims to have broken Windows 8</h1>
          <p class="byline permalink"><a href="/author/cory">Cory Doctorow</a> at 11:20 am Fri, Nov 2</p>
        </article>
        <script>
          var page_data = {"post_title":"VUPEN","post_date":"2012-11-02 11:20:30","post_status":"publish"};
        </script>
      </body></html>`)

    const result = resolveCandidates(extractFromDocument(doc, 'https://boingboing.net/post.html'), {
      now: NOW,
    })
    expect(result.published?.value.slice(0, 10)).toBe('2012-11-02')
    expect(result.published?.source).toBe('wordpress')
    // Structured and site-authored, but an implementation detail — not a
    // published contract, so never `declared`.
    expect(result.published?.confidence).toBe('derived')
  })

  it('ignores a bare `date` key, which is any variable a page happens to name', () => {
    const doc = documentFrom(`
      <html><body><script>
        var analytics = {"date":"2019-04-03","campaign":"spring"};
      </script></body></html>`)

    expect(extractInlineState(doc)).toEqual([])
  })

  it('leaves JSON-LD to the extractor that parses it properly', () => {
    const doc = documentFrom(`
      <html><body><script type="application/ld+json">
        {"@type":"Article","datePublished":"2021-03-04"}
      </script></body></html>`)

    // extractJsonLd reads this at `declared`; reading it again here would
    // double-count a stronger signal at a weaker confidence.
    expect(extractInlineState(doc)).toEqual([])
  })

  it('separates modification keys from publication ones', () => {
    const doc = documentFrom(`
      <html><body><script>
        window.__STATE__ = {"published_at":"2020-01-02T10:00:00Z","updated_at":"2023-06-07T08:00:00Z"};
      </script></body></html>`)

    const found = extractInlineState(doc)
    expect(found.find((c) => c.field === 'published')?.value.slice(0, 10)).toBe('2020-01-02')
    expect(found.find((c) => c.field === 'modified')?.value.slice(0, 10)).toBe('2023-06-07')
  })

  /**
   * The scan is anchored on the date literal and reads the key backwards from
   * it, so how much whitespace a page puts between the two is a correctness
   * question rather than a cosmetic one. Both extremes are pinned.
   */
  describe('finds the key whatever the source formatting', () => {
    it('reads a minified pair with no quotes or spaces', () => {
      const doc = documentFrom(`
        <html><body><script>var d={post_date:"2012-11-02 11:20:30"}</script></body></html>`)

      expect(extractInlineState(doc)[0]?.value.slice(0, 10)).toBe('2012-11-02')
    })

    it('reads a pretty-printed pair broken across lines', () => {
      const doc = documentFrom(`
        <html><body><script>
          var d = {
            "post_date"
              :
                "2012-11-02 11:20:30"
          }
        </script></body></html>`)

      expect(extractInlineState(doc)[0]?.value.slice(0, 10)).toBe('2012-11-02')
    })

    it('does not attach a value to a key that is not its own', () => {
      // `post_date` names the *first* value; the second belongs to `other`, which
      // is not an accepted key. Reading backwards must not reach past it.
      const doc = documentFrom(`
        <html><body><script>
          var d = {"post_date":"2012-11-02","other":"2019-08-08"};
        </script></body></html>`)

      const found = extractInlineState(doc)
      expect(found.map((c) => c.value.slice(0, 10))).toEqual(['2012-11-02'])
    })

    it('ignores a date literal with no key in front of it', () => {
      const doc = documentFrom(`
        <html><body><script>var d = ["2012-11-02", "2019-08-08"];</script></body></html>`)

      expect(extractInlineState(doc)).toEqual([])
    })
  })

  describe('which script types are read', () => {
    it('reads a Next.js __NEXT_DATA__ blob declared as application/json', () => {
      // The reason the blanket `json` test was dropped. A leading `json`
      // alternative in the skip pattern matched `application/json` and so
      // excluded exactly the blob this extractor exists to read — while also
      // making the `ld+json` alternative beside it dead code.
      const doc = documentFrom(`
        <html><body><script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"post":{"publishedAt":"2023-09-14T08:30:00Z"}}}}
        </script></body></html>`)

      const found = extractInlineState(doc)
      expect(found).toHaveLength(1)
      expect(found[0]?.value).toBe('2023-09-14T08:30Z')
      expect(found[0]?.field).toBe('published')
    })

    it('reads application/settings+json, as htmldate does', () => {
      const doc = documentFrom(`
        <html><body><script type="application/settings+json">
          {"date_published":"2018-02-11T00:00:00Z"}
        </script></body></html>`)

      expect(extractInlineState(doc)[0]?.value).toBe('2018-02-11T00:00Z')
    })

    it('still leaves ld+json to the JSON-LD extractor', () => {
      // Reading it here too would double-count a stronger signal at a weaker
      // tier.
      const doc = documentFrom(`
        <html><body><script type="application/ld+json">
          {"@type":"Article","datePublished":"2020-06-06T00:00:00Z"}
        </script></body></html>`)

      expect(extractInlineState(doc)).toEqual([])
    })
  })

  it('ranks below the metadata a site publishes for consumers', () => {
    const doc = documentFrom(`
      <html><head>
        <meta property="article:published_time" content="2024-05-05T00:00:00Z">
      </head><body><script>
        var d = {"post_date":"2024-05-01 09:00:00"};
      </script></body></html>`)

    const result = resolveCandidates(extractFromDocument(doc, 'https://example.com/a'), { now: NOW })
    expect(result.published?.source).toBe('opengraph')
  })
})
