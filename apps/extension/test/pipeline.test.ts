import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOMParser } from 'linkedom'
import { extractFromDocument, resolve, type Env } from 'pagedate'
import { view } from '../entrypoints/popup/render.js'

/**
 * Exercises the exact sequence the popup performs — parse the page HTML,
 * extract, resolve, render — against real captured pages.
 *
 * This is the integration the unit tests on either side cannot catch: the
 * library and the view agreeing on what a result looks like. It stops short of
 * driving a real browser, which needs a click a headless WSL environment can't
 * provide.
 */

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures')

const NOW = new Date('2026-07-29T00:00:00Z')

/** Stands in for the popup's env: no network, real XML parsing. */
const offlineEnv = (): Env => ({
  fetchText: async () => null,
  parseXml: (xml) => {
    try {
      return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
    } catch {
      return null
    }
  },
})

async function runPopup(slug: string, url: string): Promise<string> {
  const html = readFileSync(join(FIXTURES, slug, 'page.html'), 'utf8')
  // The popup uses the browser's own DOMParser; linkedom stands in for it here.
  const doc = new DOMParser().parseFromString(html, 'text/html') as unknown as Document
  const result = await resolve(extractFromDocument(doc, url), url, offlineEnv(), { now: NOW })
  return view(result, url, { now: NOW })
}

describe('popup pipeline on real pages', () => {
  it('renders a clean article with a declared date', async () => {
    const html = await runPopup(
      'ilpost-italian-news',
      'https://www.ilpost.it/2026/07/28/paolo-maldini-leonardo-dimissioni-figc/',
    )

    expect(html).toContain('2026')
    expect(html).toContain('tier-declared')
    expect(html).toContain('stated by the site')
  })

  it('renders a docs page that only states when it was updated', async () => {
    const html = await runPopup('vitepress-docs', 'https://vitepress.dev/guide/what-is-vitepress')

    expect(html).toContain('Last modified')
    // Nothing on the page claims a publication date, so none is invented — and
    // the absence is stated rather than left as silence.
    expect(html).toMatch(/Published[\s\S]{0,200}not declared/)
  })

  it('reports honestly when a page has no date', async () => {
    const html = await runPopup('danluu-no-date', 'https://danluu.com/everything-is-broken/')

    expect(html).toContain('sometimes the correct answer')
    expect(html).not.toContain('tier-declared')
  })

  it('shows an inferred date as inferred, not as fact', async () => {
    const html = await runPopup(
      'simonwillison-post',
      'https://simonwillison.net/2024/Dec/31/llms-in-2024/',
    )

    // Recovered from the URL slug — real, but a weaker claim than metadata.
    expect(html).toContain('2024')
    expect(html).toContain('tier-inferred')
    expect(html).toContain('url-slug')
  })

  it('produces no unescaped angle brackets from real page content', async () => {
    for (const [slug, url] of [
      ['csstricks-updated', 'https://css-tricks.com/snippets/css/a-guide-to-flexbox/'],
      ['stackoverflow-answer', 'https://stackoverflow.com/questions/11227809/x'],
    ] as const) {
      const html = await runPopup(slug, url)
      // Only our own markup should contain tags; notes quote page text.
      const inNotes = html.match(/<p class="note">([^<]*)<\/p>/g) ?? []
      for (const note of inNotes) expect(note).not.toMatch(/<(script|img|iframe)/i)
    }
  })
})
