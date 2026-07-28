import { describe, expect, it } from 'vitest'
import { findDates } from '../src/index.js'
import { extractSitemap } from '../src/extract/sitemap.js'
import { documentFrom, NOW, strictEnv } from './helpers.js'

const PAGE_URL = 'https://docs.example.com/guide/install/'

const urlset = (entries: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`

const SITEMAP = urlset(`
  <url><loc>https://docs.example.com/guide/</loc><lastmod>2024-01-02</lastmod></url>
  <url><loc>https://docs.example.com/guide/install/</loc><lastmod>2025-03-14T09:30:00Z</lastmod></url>
  <url><loc>https://docs.example.com/guide/config/</loc><lastmod>2023-08-08</lastmod></url>`)

describe('sitemap extraction', () => {
  it('reads <lastmod> for the page from the well-known sitemap', async () => {
    const found = await extractSitemap(
      documentFrom('<html><body><p>No date anywhere.</p></body></html>'),
      new URL(PAGE_URL),
      strictEnv({ text: { 'https://docs.example.com/sitemap.xml': SITEMAP } }),
    )

    expect(found).toHaveLength(1)
    expect(found[0]?.value).toBe('2025-03-14T09:30Z')
    expect(found[0]?.field).toBe('modified')
    expect(found[0]?.confidence).toBe('derived')
    expect(found[0]?.source).toBe('sitemap')
  })

  it('prefers a sitemap the page declares over the well-known path', async () => {
    const doc = documentFrom('<link rel="sitemap" href="/custom-sitemap.xml">')

    const found = await extractSitemap(
      doc,
      new URL(PAGE_URL),
      // A stub for /sitemap.xml is deliberately absent: strictEnv throws on any
      // request that was not stubbed, so probing it would fail this test.
      strictEnv({ text: { 'https://docs.example.com/custom-sitemap.xml': SITEMAP } }),
    )

    expect(found[0]?.value).toBe('2025-03-14T09:30Z')
  })

  it('matches the page through its canonical URL', async () => {
    const doc = documentFrom(
      '<link rel="canonical" href="https://docs.example.com/guide/install/">',
    )

    const found = await extractSitemap(
      doc,
      new URL('https://docs.example.com/guide/install/?utm_source=newsletter'),
      strictEnv({ text: { 'https://docs.example.com/sitemap.xml': SITEMAP } }),
    )

    expect(found[0]?.value).toBe('2025-03-14T09:30Z')
  })

  it('follows a sitemap index to the child most like the page path', async () => {
    const index = `<?xml version="1.0" encoding="UTF-8"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://docs.example.com/news/sitemap.xml</loc></sitemap>
        <sitemap><loc>https://docs.example.com/guide/sitemap.xml</loc></sitemap>
      </sitemapindex>`

    const found = await extractSitemap(
      documentFrom('<p>No date.</p>'),
      new URL(PAGE_URL),
      strictEnv({
        text: {
          'https://docs.example.com/sitemap.xml': index,
          // /news/sitemap.xml is not stubbed — reaching for it would throw,
          // which is the assertion that the ordering heuristic worked.
          'https://docs.example.com/guide/sitemap.xml': SITEMAP,
        },
      }),
    )

    expect(found[0]?.value).toBe('2025-03-14T09:30Z')
  })

  it('ignores a sitemap whose every entry carries the same lastmod', async () => {
    const stamped = urlset(
      Array.from(
        { length: 12 },
        (_, i) =>
          `<url><loc>https://docs.example.com/guide/p${i}/</loc><lastmod>2026-02-01</lastmod></url>`,
      ).join('') +
        `<url><loc>${PAGE_URL}</loc><lastmod>2026-02-01</lastmod></url>`,
    )

    const found = await extractSitemap(
      documentFrom('<p>No date.</p>'),
      new URL(PAGE_URL),
      strictEnv({ text: { 'https://docs.example.com/sitemap.xml': stamped } }),
    )

    expect(found).toEqual([])
  })

  it('still trusts a shared lastmod on a site small enough for it to be real', async () => {
    const small = urlset(`
      <url><loc>https://docs.example.com/guide/</loc><lastmod>2024-01-02</lastmod></url>
      <url><loc>${PAGE_URL}</loc><lastmod>2024-01-02</lastmod></url>`)

    const found = await extractSitemap(
      documentFrom('<p>No date.</p>'),
      new URL(PAGE_URL),
      strictEnv({ text: { 'https://docs.example.com/sitemap.xml': small } }),
    )

    expect(found[0]?.value).toBe('2024-01-02')
  })

  it('returns nothing when the page is absent from the sitemap', async () => {
    const found = await extractSitemap(
      documentFrom('<p>No date.</p>'),
      new URL('https://docs.example.com/guide/missing/'),
      strictEnv({
        text: {
          'https://docs.example.com/sitemap.xml': SITEMAP,
          'https://docs.example.com/sitemap_index.xml': '',
          'https://docs.example.com/sitemap-index.xml': '',
        },
      }),
    )

    expect(found).toEqual([])
  })
})

describe('sitemap in the pipeline', () => {
  it('is skipped when the page already declares a modification date', async () => {
    const doc = documentFrom(`
      <meta property="article:published_time" content="2024-05-01">
      <meta property="article:modified_time" content="2025-06-02">`)

    // No sitemap stub: strictEnv throws if the lookup is attempted at all.
    const result = await findDates(doc, PAGE_URL, strictEnv({ text: {} }), { now: NOW })

    expect(result.modified?.value).toBe('2025-06-02')
    expect(result.candidates.some((c) => c.source === 'sitemap')).toBe(false)
  })

  it('answers a page with no date of its own from the site sitemap', async () => {
    const result = await findDates(
      documentFrom('<html><body><article>Undated prose.</article></body></html>'),
      PAGE_URL,
      strictEnv({ text: { 'https://docs.example.com/sitemap.xml': SITEMAP } }),
      { now: NOW },
    )

    expect(result.modified?.source).toBe('sitemap')
    // `<lastmod>` says when the file changed and nothing more, so it must not
    // be laundered into a publication date the site never stated.
    expect(result.published).toBeUndefined()
  })

  it('can be turned off', async () => {
    const result = await findDates(
      documentFrom('<article>Undated prose.</article>'),
      PAGE_URL,
      strictEnv({ text: {} }),
      { now: NOW, sitemap: false },
    )

    expect(result.candidates).toEqual([])
  })
})
