import { describe, expect, it } from 'vitest'
import type { Candidate, Env } from '../src/types.js'
import { extractFromDocument, findDates } from '../src/index.js'
import { extractFeed } from '../src/extract/feed.js'
import { isSafeFetchTarget } from '../src/extract/urlGuard.js'
import { fetchEnv } from '../src/fetchEnv.js'
import { detectDayFirst } from '../src/parse/locale.js'
import { parseDateString, toInstant } from '../src/parse/normalize.js'
import { checkPlausibility } from '../src/parse/plausibility.js'
import { resolveCandidates } from '../src/resolve.js'
import { staleness } from '../src/staleness.js'
import { documentFrom, NOW, strictEnv } from './helpers.js'

/**
 * Regressions from the pre-release review.
 *
 * Every case here was reproduced against the build before it was fixed, and is
 * written as the input that went wrong rather than as a description of the
 * rule, so that a later rewrite of the rule still has to get these right.
 */

const candidate = (over: Partial<Candidate>): Candidate => ({
  value: '2024-01-01',
  precision: 'day',
  field: 'published',
  source: 'jsonld',
  confidence: 'declared',
  ...over,
})

const page = (body: string, head = ''): Document =>
  documentFrom(`<html lang="en"><head>${head}</head><body><article>${body}</article></body></html>`)

const published = async (doc: Document, url = 'https://example.com/a-page'): Promise<string | undefined> =>
  (await findDates(doc, url, {}, { now: NOW })).published?.value

describe('a month name is not found inside a longer word', () => {
  const words = [
    'Smart 2024',
    'Walmart 2024 Report',
    'Sunset 2019',
    'Dataset 2020',
    'Oxygen 2024',
    'Copenhagen 2019',
    'Marriott 2023',
    'Nordic 2022',
    'Myanmar 2021 coup',
    'Reset 20000',
    'Call 415-10-2024',
  ]

  for (const text of words) {
    it(text, async () => {
      expect(await published(page(`<h1>${text}</h1>`))).toBeUndefined()
    })
  }

  it('not in a byline either', async () => {
    expect(await published(page('<p>Published by Scott 2019</p>'))).toBeUndefined()
    expect(await published(page('<span class="date">Sunset 2019</span>'))).toBeUndefined()
  })

  it('still finds the month when it is a word of its own', async () => {
    expect(await published(page('<span class="date">12 Mar 2024</span>'))).toBe('2024-03-12')
    expect(await published(page('<span class="date">Sept 3, 2019</span>'))).toBe('2019-09-03')
  })

  it('still finds a full month name run into the label before it', async () => {
    // Adjacent elements with no whitespace between them join like this.
    const doc = page('<p class="byline"><span>Posted</span><span>September 12, 2023</span></p>')
    expect(await published(doc)).toBe('2023-09-12')
  })
})

describe('month-first dates in scripts `\\b` does not understand', () => {
  const cases: Array<[string, string]> = [
    ['Март 2024', '2024-03'],
    ['Μαρτίου 2024', '2024-03'],
    ['مارس 2024', '2024-03'],
    ['मार्च 2024', '2024-03'],
  ]

  for (const [input, value] of cases) {
    it(input, () => expect(parseDateString(input)?.value).toBe(value))
  }

  it('does not start reading month names out of words', () => {
    expect(parseDateString('Smart 2024')).toBeNull()
  })
})

describe('timestamp spellings', () => {
  it('reads a lowercase `t` and `z`', () => {
    expect(parseDateString('2024-03-12t10:00:00z')?.value).toBe('2024-03-12T10:00Z')
  })

  it('keeps an hour-only offset', () => {
    expect(parseDateString('2024-03-12T10:00:00+05')?.value).toBe('2024-03-12T10:00+05:00')
  })

  it('reads the year-first form with a clock time after it', () => {
    expect(parseDateString('2024/03/12 10:00')).toEqual({ value: '2024-03-12', precision: 'day' })
  })
})

describe('toInstant', () => {
  it('reads a zoneless timestamp as UTC, wherever it runs', () => {
    expect(toInstant('2024-03-12T10:00')?.toISOString()).toBe('2024-03-12T10:00:00.000Z')
  })

  it('refuses a date that does not exist', () => {
    expect(toInstant('2024-02-30')).toBeNull()
    expect(toInstant('2024-13')).toBeNull()
    expect(toInstant('2024-02-30T10:00Z')).toBeNull()
    expect(checkPlausibility(candidate({ value: '2024-02-30' }), NOW).ok).toBe(false)
  })
})

describe('detectDayFirst', () => {
  it('reads `en_US` as the tag it means', () => {
    expect(detectDayFirst('en_US', 'example.com')).toBe('month-first')
  })

  it('takes no hint from a country-code TLD sold as a generic one', () => {
    expect(detectDayFirst('en', 'example.io')).toBe('unknown')
    expect(detectDayFirst('en', 'example.co')).toBe('unknown')
    expect(detectDayFirst('en', 'example.de')).toBe('day-first')
  })

  it('takes no hint from a lang attribute that is not a language tag', () => {
    expect(detectDayFirst('{{ lang }}', 'example.com')).toBe('unknown')
  })
})

describe('feed and sitemap entries are matched on more than the path', () => {
  const feed = (links: string[]): string =>
    `<?xml version="1.0"?><rss version="2.0"><channel>${links
      .map(
        (link) =>
          `<item><link>${link}</link><pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate></item>`,
      )
      .join('')}</channel></rss>`

  const declaring = documentFrom(
    '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body></body></html>',
  )

  const lookup = (pageUrl: string, links: string[]): Promise<Candidate[]> =>
    extractFeed(
      declaring,
      new URL(pageUrl),
      strictEnv({ text: { [new URL('/feed.xml', pageUrl).toString()]: feed(links) } }),
    )

  it('does not match a different story on the same script path', async () => {
    const found = await lookup('https://example.com/story.php?id=1234', [
      'https://example.com/story.php?id=99',
      'https://example.com/story.php?id=7',
    ])
    expect(found).toEqual([])
  })

  it('does not match the same path on another site', async () => {
    expect(await lookup('https://example.com/about', ['https://other.example.org/about'])).toEqual([])
  })

  it('still matches across tracking parameters, www and a trailing slash', async () => {
    const found = await lookup('https://example.com/posts/thing', [
      'https://www.example.com/posts/thing/?utm_source=rss',
    ])
    expect(found.length).toBeGreaterThan(0)
  })
})

describe('declared feeds are capped', () => {
  it('fetches at most three, and each once', async () => {
    const links = Array.from(
      { length: 50 },
      (_, i) => `<link rel="alternate" type="application/rss+xml" href="https://feeds.example.net/${i % 25}.xml">`,
    ).join('')
    const fetched: string[] = []
    const env: Env = {
      fetchText: async (url) => {
        fetched.push(url)
        return null
      },
      parseXml: () => null,
    }

    await extractFeed(documentFrom(`<html><head>${links}</head><body></body></html>`), new URL('https://example.com/p'), env)
    expect(fetched).toHaveLength(3)
    expect(new Set(fetched).size).toBe(3)
  })

  it('fetches nothing when there is no XML parser to read the answer', async () => {
    const env: Env = {
      fetchText: async () => {
        throw new Error('fetched a feed nothing could parse')
      },
    }
    const doc = documentFrom(
      '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body></body></html>',
    )
    expect(await extractFeed(doc, new URL('https://example.com/p'), env)).toEqual([])
  })
})

describe('the address guard', () => {
  const refused = [
    'http://localhost./',
    'http://foo.localhost./',
    'http://metadata.google.internal./',
    'http://localhost%2e/',
    'http://[fec0::1]/',
    'http://[::127.0.0.1]/',
    'http://[::ffff:0:127.0.0.1]/',
    'http://[64:ff9b:1::7f00:1]/',
    'http://[2002:7f00:1::]/',
  ]
  for (const url of refused) it(`refuses ${url}`, () => expect(isSafeFetchTarget(url)).toBe(false))

  const allowed = [
    'https://example.com./feed.xml',
    'http://[::ffff:8.8.8.8]/',
    'http://[64:ff9b::808:808]/',
    'http://[2002:808:808::1]/',
    'http://[2001:4860:4860::8888]/',
  ]
  for (const url of allowed) it(`allows ${url}`, () => expect(isSafeFetchTarget(url)).toBe(true))
})

describe('the request deadline covers the body', () => {
  it('abandons a response that sends its headers and then stalls', async () => {
    const stalling: typeof globalThis.fetch = async (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<html>'))
          init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
        },
      })
      return new Response(body, { status: 200 })
    }

    const started = Date.now()
    const text = await fetchEnv({ fetch: stalling, timeoutMs: 100 }).fetchText!('https://example.com/')
    expect(Date.now() - started).toBeLessThan(2000)
    // What had arrived is kept: a partial page is still answerable.
    expect(text).toBe('<html>')
  })
})

describe('declared dates at different precisions', () => {
  it('do not contradict each other when one contains the other', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2024', precision: 'year', source: 'opengraph' }),
        candidate({ value: '2024-11-20T10:00Z', precision: 'minute' }),
      ],
      { now: NOW },
    )
    expect(result.conflict).toBeUndefined()
  })

  it('still contradict each other when they do not overlap', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2022', precision: 'year', source: 'opengraph' }),
        candidate({ value: '2024-11-20T10:00Z', precision: 'minute' }),
      ],
      { now: NOW },
    )
    expect(result.conflict?.kind).toBe('declared-disagreement')
  })
})

describe('a modification date before the publication date', () => {
  const stale = [
    candidate({ value: '2024-05-01T10:00Z', precision: 'minute', source: 'opengraph' }),
    candidate({ value: '2023-01-01T10:00Z', precision: 'minute', source: 'opengraph', field: 'modified' }),
  ]

  it('is not reported as the answer', () => {
    const result = resolveCandidates(stale, { now: NOW })
    expect(result.published?.value).toBe('2024-05-01T10:00Z')
    expect(result.modified).toBeUndefined()
    // Still visible to a caller who wants to see everything the page said.
    expect(result.candidates).toHaveLength(2)
  })

  it('does not make the page look older than its own publication', () => {
    const verdict = staleness(resolveCandidates(stale, { now: NOW }), { maxAgeDays: 100_000, now: NOW })
    const sincePublished = (NOW.getTime() - Date.parse('2024-05-01T10:00Z')) / 86_400_000
    expect(verdict.ageDays).toBeLessThanOrEqual(Math.ceil(sincePublished))
  })

  it('falls back to a later modification date when there is one', () => {
    const result = resolveCandidates(
      [...stale, candidate({ value: '2024-06-01', field: 'modified', source: 'sitemap', confidence: 'derived' })],
      { now: NOW },
    )
    expect(result.modified?.value).toBe('2024-06-01')
  })

  it('allows a day of slack for the two being stamped in different zones', () => {
    const result = resolveCandidates(
      [
        candidate({ value: '2024-05-01T23:30+02:00', precision: 'minute' }),
        candidate({ value: '2024-05-01', field: 'modified', source: 'sitemap', confidence: 'derived' }),
      ],
      { now: NOW },
    )
    expect(result.modified?.value).toBe('2024-05-01')
  })
})

describe('minConfidence', () => {
  it('applies to the signals that arrive over the network', async () => {
    const url = 'https://example.com/posts/thing'
    const sitemap = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>${url}</loc><lastmod>2024-01-05</lastmod></url></urlset>`
    const requested: string[] = []
    const env: Env = {
      fetchText: async (target) => {
        requested.push(target)
        return target.endsWith('/sitemap.xml') ? sitemap : null
      },
      fetchHeaders: async () => ({ 'last-modified': 'Fri, 05 Jan 2024 10:00:00 GMT' }),
      parseXml: strictEnv().parseXml!,
    }

    const result = await findDates(page('<p>Nothing dated.</p>'), url, env, {
      minConfidence: 'declared',
      httpHeaders: true,
      now: NOW,
    })

    expect(result.candidates).toEqual([])
    expect(result.modified).toBeUndefined()
    // And the sitemap, which can only answer at `derived`, is not asked.
    expect(requested.some((target) => target.includes('sitemap'))).toBe(false)
  })

  it('survives an Env whose fetchHeaders throws before returning a promise', async () => {
    const env: Env = {
      fetchHeaders: () => {
        throw new Error('no network here')
      },
    }
    const result = await findDates(page('<p>Nothing dated.</p>'), 'https://example.com/x', env, {
      httpHeaders: true,
      now: NOW,
    })
    expect(result.candidates).toEqual([])
  })
})

describe('staleness', () => {
  it('hands each caller its own answer object', () => {
    const first = staleness({ candidates: [] }, { maxAgeDays: 30, now: NOW })
    first.stale = true
    expect(staleness({ candidates: [] }, { maxAgeDays: 30, now: NOW }).stale).toBeNull()
  })
})

describe('hAtom', () => {
  it('reads the timestamp out of the title attribute, offset included', () => {
    const doc = page('<abbr class="published" title="2016-12-23T05:11:00-05:00">5:11 AM</abbr>')
    const found = extractFromDocument(doc, 'https://example.com/a-page').find((c) => c.source === 'marked-date')
    expect(found).toMatchObject({ value: '2016-12-23T05:11-05:00', field: 'published', confidence: 'derived' })
  })
})

describe('dates that belong to a related work', () => {
  it('JSON-LD under isPartOf is not the article’s declared date', async () => {
    const doc = page(
      '<p>Body.</p>',
      `<script type="application/ld+json">${JSON.stringify({
        '@type': 'NewsArticle',
        datePublished: '2024-03-20T10:00:00Z',
        isPartOf: { '@type': 'CreativeWork', datePublished: '2024-03-01T10:00:00Z' },
      })}</script>`,
    )
    expect(await published(doc)).toBe('2024-03-20T10:00Z')
  })

  it('microdata inside a Comment item is not the article’s declared date', async () => {
    const doc = page(`
      <div itemscope itemtype="https://schema.org/Article">
        <meta itemprop="datePublished" content="2024-03-20T10:00:00Z">
        <div itemprop="comment" itemscope itemtype="https://schema.org/Comment">
          <meta itemprop="datePublished" content="2024-03-09T10:00:00Z">
        </div>
      </div>`)
    expect(await published(doc)).toBe('2024-03-20T10:00Z')
  })
})
