import { describe, expect, it } from 'vitest'
import { extractFromDocument } from '../src/index.js'
import { extractBareText } from '../src/extract/bareText.js'
import { parseDateString } from '../src/parse/normalize.js'
import { documentFrom } from './helpers.js'

const URL_ = 'https://example.com/posts/thing'
const bare = (html: string, url = URL_) => extractBareText(documentFrom(html), new URL(url))

describe('German date formats', () => {
  it('reads the ordinal-dot form', () => {
    // "19." is an ordinal marker, not a separator.
    expect(parseDateString('19. Juli 2014')).toEqual({ value: '2014-07-19', precision: 'day' })
    expect(parseDateString('1. Dezember 2011')).toEqual({ value: '2011-12-01', precision: 'day' })
  })

  it('reads German month abbreviations', () => {
    expect(parseDateString('19. Okt. 2014')).toEqual({ value: '2014-10-19', precision: 'day' })
    expect(parseDateString('3. Dez 2018')).toEqual({ value: '2018-12-03', precision: 'day' })
    expect(parseDateString('5. Mär 2020')).toEqual({ value: '2020-03-05', precision: 'day' })
  })

  it('reads dotted numeric dates as day-first for German pages', () => {
    expect(parseDateString('16.12.2012', { dayFirst: 'day-first' })).toEqual({
      value: '2012-12-16',
      precision: 'day',
    })
  })
})

describe('unlabelled dates', () => {
  it('reads a bare byline date', () => {
    const found = bare(`<article><h1>Title</h1><p>December 11, 2023</p><p>Body.</p></article>`)

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      value: '2023-12-11',
      source: 'text-date',
      confidence: 'inferred',
    })
  })

  it('leaves the field unknown rather than claiming "published"', () => {
    // There is no label, so asserting a field would state something the page
    // never said. Resolution promotes it only if nothing else claims published.
    expect(bare(`<article><p>December 11, 2023</p></article>`)[0]?.field).toBe('unknown')
  })

  it('reads the hAtom <abbr class="published"> convention', () => {
    const found = bare(
      `<article><abbr class="published" title="Sonntag, Dezember 16th, 2012">16.12.2012</abbr></article>`,
      'https://blog.kinra.de/?p=959',
    )

    expect(found[0]?.value).toBe('2012-12-16')
  })

  it('only runs when the labelled extractors found nothing', () => {
    // A page with real metadata must not have bare text competing with it.
    const doc = documentFrom(`
      <html><head>
        <meta property="article:published_time" content="2023-04-11T10:00:00Z">
      </head><body><article><p>December 11, 2023</p></article></body></html>`)

    const found = extractFromDocument(doc, URL_)
    expect(found.some((c) => c.source === 'text-date')).toBe(false)
  })
})

describe('borrowed content is not the page’s own date', () => {
  it('ignores dates inside a blockquote', () => {
    expect(bare(`<article><blockquote><p>January 28, 2013</p></blockquote></article>`)).toEqual([])
  })

  it('ignores dates inside off-site link text', () => {
    // The danluu case: a bare page whose only dates belong to things it links to.
    const found = bare(
      `<article><p><a href="https://twitter.com/x/status/1">January 28, 2013</a></p></article>`,
    )
    expect(found).toEqual([])
  })

  it('keeps dates in same-site link text, which is a common permalink byline', () => {
    const found = bare(
      `<article><p><a href="https://example.com/2023/12/">December 11, 2023</a></p></article>`,
    )
    expect(found[0]?.value).toBe('2023-12-11')
  })

  it('ignores dates inside code blocks', () => {
    expect(bare(`<article><pre><code>const d = "2023-12-11"</code></pre></article>`)).toEqual([])
  })
})

describe('noise guards', () => {
  it('ignores a date buried in prose', () => {
    const found = bare(
      `<article><p>The conference took place on 3 December 2021 in Rome and was well attended.</p></article>`,
    )
    expect(found).toEqual([])
  })

  it('accepts a date in byline markup even with surrounding words', () => {
    const found = bare(
      `<article><p class="post-meta">by Dan Abramov on December 11, 2023 · 5 min read</p></article>`,
    )
    expect(found[0]?.value).toBe('2023-12-11')
  })

  it('ignores parenthesised dates in long link lists', () => {
    const found = bare(
      `<article><span>abstimmungsergebnis bundesrat (28.11.2008) und weiteres</span></article>`,
    )
    expect(found).toEqual([])
  })

  it('caps how many dates it will emit', () => {
    const items = Array.from(
      { length: 20 },
      (_, i) => `<li>${String(i + 1).padStart(2, '0')} March 2024</li>`,
    ).join('')
    expect(bare(`<article><ul>${items}</ul></article>`).length).toBeLessThanOrEqual(6)
  })
})

describe('page-region markers', () => {
  it("does not read a newspaper's registration date out of a page footer", () => {
    // Il Post ends every page with this line. `footer` is a positive marker —
    // documentation sites put "Last updated" there — but it is a reason to read
    // a *labelled* date, not to accept one buried in a sentence.
    const doc = documentFrom(`
      <html><body>
        <article><h1>I danni causati da Sandy</h1><p>Le foto della tempesta.</p></article>
        <div id="footer"><div class="group">
          <p>Il Post è una testata registrata presso il Tribunale di Milano, 419 del 28 settembre 2009</p>
        </div></div>
      </body></html>`)

    expect(extractBareText(doc, new URL('https://www.ilpost.it/2012/05/01/sandy/'))).toEqual([])
  })

  it('still reads a bare date from byline markup, where words around it are expected', () => {
    const doc = documentFrom(`
      <html><body><article>
        <p class="entry-meta">by Dan Luu · 5 min read · December 11, 2023 · tagged performance</p>
      </article></body></html>`)

    const found = extractBareText(doc, new URL('https://danluu.com/post/'))
    expect(found[0]?.value).toBe('2023-12-11')
  })
})
