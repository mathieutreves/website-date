import { DOMParser } from 'linkedom'
import { describe, expect, it } from 'vitest'
import {
  ENGINES,
  engineFor,
  isSearchHost,
  resultLinks,
  targetOf,
  SEARCH_ORIGINS,
} from '../lib/search-sites.js'

const parse = (html: string, base: string): Document => {
  const doc = new DOMParser().parseFromString(html, 'text/html') as unknown as Document
  // linkedom resolves `anchor.href` against `document.baseURI`, which needs a
  // <base> to be anything other than about:blank.
  const base_ = doc.createElement('base')
  base_.setAttribute('href', base)
  doc.querySelector('head')?.append(base_)
  return doc
}

describe('isSearchHost', () => {
  const google = ENGINES.find((e) => e.id === 'google')!
  const ddg = ENGINES.find((e) => e.id === 'duckduckgo')!

  it('matches a bare label followed only by a public suffix', () => {
    expect(isSearchHost('www.google.com', google)).toBe(true)
    expect(isSearchHost('www.google.co.uk', google)).toBe(true)
    expect(isSearchHost('google.de', google)).toBe(true)
    expect(isSearchHost('google.com.au', google)).toBe(true)
  })

  /*
   * The reason this is label-wise rather than a substring test. A results-page
   * annotator that matched `google.phishing.example` would run its selectors on
   * a page an attacker controls — and on the fetch tier, spend requests there.
   */
  it('refuses a lookalike that merely contains the label', () => {
    expect(isSearchHost('google.phishing.example', google)).toBe(false)
    expect(isSearchHost('notgoogle.com', google)).toBe(false)
    expect(isSearchHost('mygoogle.com', google)).toBe(false)
    // A registrable domain after the label means the label was a subdomain.
    expect(isSearchHost('google.com.evil.co', google)).toBe(false)
    expect(isSearchHost('www.google.com.attacker.net', google)).toBe(false)
  })

  it('matches a dotted entry as a domain suffix only', () => {
    expect(isSearchHost('duckduckgo.com', ddg)).toBe(true)
    expect(isSearchHost('html.duckduckgo.com', ddg)).toBe(true)
    expect(isSearchHost('duckduckgo.com.evil.example', ddg)).toBe(false)
  })

  it('ignores case and a trailing root dot', () => {
    expect(isSearchHost('WWW.Google.COM.', google)).toBe(true)
  })
})

describe('engineFor', () => {
  it('identifies each engine it claims to support', () => {
    expect(engineFor('https://www.google.com/search?q=x')?.id).toBe('google')
    expect(engineFor('https://www.bing.com/search?q=x')?.id).toBe('bing')
    expect(engineFor('https://duckduckgo.com/?q=x')?.id).toBe('duckduckgo')
    expect(engineFor('https://news.ycombinator.com/')?.id).toBe('hackernews')
    expect(engineFor('https://old.reddit.com/r/x')?.id).toBe('reddit')
  })

  it('returns null for anything else, including new Reddit', () => {
    expect(engineFor('https://example.com/search?q=x')).toBeNull()
    expect(engineFor('https://www.reddit.com/r/x')).toBeNull()
    expect(engineFor('not a url')).toBeNull()
  })

  it('has a declared origin for every engine', () => {
    // A selector table entry with no matching host permission is a feature that
    // silently never runs.
    for (const engine of ENGINES) {
      const covered = SEARCH_ORIGINS.some((pattern) =>
        engine.hosts.some((host) => pattern.includes(host)),
      )
      expect(covered, engine.id).toBe(true)
    }
  })
})

describe('resultLinks', () => {
  const google = ENGINES.find((e) => e.id === 'google')!

  it('finds result anchors inside the results region', () => {
    const doc = parse(
      `<html><head></head><body>
        <div id="search">
          <a href="https://a.example/post"><h3>First</h3></a>
          <a href="https://b.example/post"><h3>Second</h3></a>
        </div>
      </body></html>`,
      'https://www.google.com/search?q=x',
    )

    const links = resultLinks(doc, google, 'https://www.google.com/search?q=x')
    expect(links.map((a) => a.href)).toEqual([
      'https://a.example/post',
      'https://b.example/post',
    ])
  })

  it('ignores anything outside the results region', () => {
    const doc = parse(
      `<html><head></head><body>
        <nav><a href="https://ads.example/x"><h3>Ad</h3></a></nav>
        <div id="search"><a href="https://a.example/post"><h3>Real</h3></a></div>
      </body></html>`,
      'https://www.google.com/search?q=x',
    )

    expect(resultLinks(doc, google, 'https://www.google.com/search?q=x')).toHaveLength(1)
  })

  /*
   * The single rule that removes most over-collection: an engine's own
   * pagination, settings and related searches all sit under its hostname, and
   * none of them is a result. It is what lets the selectors stay loose.
   */
  it('drops the engine’s own links', () => {
    const doc = parse(
      `<html><head></head><body><div id="search">
        <a href="https://www.google.com/search?q=x&start=10"><h3>Next</h3></a>
        <a href="https://a.example/post"><h3>Real</h3></a>
      </div></body></html>`,
      'https://www.google.com/search?q=x',
    )

    const links = resultLinks(doc, google, 'https://www.google.com/search?q=x')
    expect(links.map((a) => a.href)).toEqual(['https://a.example/post'])
  })

  it('drops non-http schemes', () => {
    const doc = parse(
      `<html><head></head><body><div id="search">
        <a href="javascript:void(0)"><h3>Nope</h3></a>
      </div></body></html>`,
      'https://www.google.com/search?q=x',
    )

    expect(resultLinks(doc, google, 'https://www.google.com/search?q=x')).toEqual([])
  })

  it('returns empty rather than throwing when the selector matches nothing', () => {
    const doc = parse('<html><head></head><body><p>redesigned</p></body></html>', 'https://www.google.com/')
    expect(resultLinks(doc, google, 'https://www.google.com/search?q=x')).toEqual([])
  })
})

describe('targetOf', () => {
  /*
   * Not cosmetic. The free tier dates the *path*, and a redirector's path
   * carries no date — so without unwrapping, every such result falls through to
   * a fetch it did not need.
   */
  it('unwraps a tracking redirect to the real target', () => {
    expect(targetOf('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F2019%2F03%2F04%2Fp%2F'))
      .toBe('https://a.example/2019/03/04/p/')
    expect(targetOf('https://www.google.com/url?url=https%3A%2F%2Fa.example%2Fpost')).toBe(
      'https://a.example/post',
    )
  })

  it('leaves a plain URL alone', () => {
    expect(targetOf('https://a.example/post?q=1')).toBe('https://a.example/post?q=1')
  })

  it('ignores a parameter that is not an absolute http URL', () => {
    expect(targetOf('https://a.example/search?q=cats')).toBe('https://a.example/search?q=cats')
    expect(targetOf('https://a.example/x?url=/relative')).toBe('https://a.example/x?url=/relative')
  })

  it('hands back what it was given when that is not a URL', () => {
    expect(targetOf('nonsense')).toBe('nonsense')
  })
})
