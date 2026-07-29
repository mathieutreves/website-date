import { describe, expect, it } from 'vitest'
import { extractFromDocument, findDates, resolveCandidates } from '../src/index.js'
import { extractInlineState } from '../src/extract/inlineState.js'
import { surroundingText } from '../src/extract/context.js'
import { documentFrom, NOW } from './helpers.js'
import type { Candidate, Env } from '../src/types.js'

/**
 * The input to this library is whatever the open web hands it, so "a page built
 * to be expensive" is a normal input rather than an exotic one. These are the
 * shapes that go quadratic under the obvious implementation of each pass, kept
 * here so a future change cannot quietly reintroduce one.
 *
 * Timing assertions carry a wide margin deliberately. The bound is set to catch
 * a jump from linear to quadratic — which on these inputs is milliseconds
 * against seconds — not to measure this machine.
 */

const BUDGET_MS = 2_000

function elapsed(work: () => void): number {
  const started = performance.now()
  work()
  return performance.now() - started
}

describe('cost bounds on hostile documents', () => {
  it('resolves a page repeating one declared date without going quadratic', () => {
    // The worst case for an all-pairs conflict check: every pair agrees, so an
    // early exit on disagreement never fires and all n²/2 comparisons run. 3000
    // of these is 183 KB of HTML, and quadratic here costs seconds.
    const html = `<html><head>${'<meta property="article:published_time" content="2020-01-01T00:00:00Z">'.repeat(3000)}</head><body>x</body></html>`
    const doc = documentFrom(html)

    let result: ReturnType<typeof resolveCandidates> | undefined
    const ms = elapsed(() => {
      result = resolveCandidates(extractFromDocument(doc, 'https://example.com/post', {}), {
        now: NOW,
      })
    })

    expect(ms).toBeLessThan(BUDGET_MS)
    expect(result?.published?.value).toBe('2020-01-01T00:00Z')
    // Agreement is not a conflict, however many times it is repeated.
    expect(result?.conflict).toBeUndefined()
  })

  it('still reports a disagreement between declared dates, naming the widest pair', () => {
    const candidates: Candidate[] = [
      cand({ value: '2020-01-01T00:00Z', source: 'opengraph' }),
      cand({ value: '2020-01-05T00:00Z', source: 'jsonld' }),
      cand({ value: '2023-06-01T00:00Z', source: 'itemprop' }),
    ]

    const result = resolveCandidates(candidates, { now: NOW })

    expect(result.conflict?.kind).toBe('declared-disagreement')
    // The extremes, not merely the first pair that happened to disagree.
    expect(result.conflict?.detail).toContain('opengraph')
    expect(result.conflict?.detail).toContain('itemprop')
    expect(result.conflict?.gapDays).toBe(1247)
  })

  it('scans a document of <time> tags beside bulk text in linear time', () => {
    // `surroundingText` read the element's and its parent's full `textContent`
    // before slicing to 400. With the tags as siblings of the filler, that
    // rebuilt the whole document once per tag: 1.1 MB of HTML, 13.5 seconds.
    const filler = '<p>lorem ipsum dolor sit amet consectetur adipiscing elit</p>'.repeat(16_000)
    const tags = '<time datetime="2024-03-12">March 12, 2024</time>'.repeat(2_000)
    const doc = documentFrom(`<html><body>${filler}${tags}</body></html>`)

    let candidates: Candidate[] = []
    const ms = elapsed(() => {
      candidates = extractFromDocument(doc, 'https://example.com/post', {})
    })

    expect(ms).toBeLessThan(BUDGET_MS)
    expect(candidates.some((c) => c.value.startsWith('2024-03-12'))).toBe(true)
  })

  it('survives markup nested deeper than the parser can recurse', () => {
    // node-html-parser recurses per level in `findOne`, so roughly 8000 nested
    // elements — 88 KB — overflowed the stack inside the first querySelectorAll
    // and threw straight out of the public API.
    const depth = 12_000
    const doc = documentFrom(
      `<html><body>${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}</body></html>`,
    )

    expect(() => extractFromDocument(doc, 'https://example.com/post', {})).not.toThrow()
  })

  it('answers from the URL when every DOM signal is lost to the parser', () => {
    // Worth being precise about what `safely` buys. The stack overflow happens
    // inside the *selector engine*, so it takes down every extractor that runs a
    // query — the page's own `<meta>` included. What survives is the answer that
    // never touched the DOM: the date in the URL. That is a degraded result
    // rather than a dead process, which is the whole claim.
    const depth = 12_000
    const doc = documentFrom(
      `<html><head><meta property="article:published_time" content="2021-04-05T00:00:00Z"></head>` +
        `<body>${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}</body></html>`,
    )

    const candidates = extractFromDocument(doc, 'https://example.com/2021/04/05/post', {})
    expect(candidates.some((c) => c.value.startsWith('2021-04-05'))).toBe(true)
  })

  it('bounds the inline-script scan within a single script, not just between scripts', () => {
    // The budget was checked between scripts and decremented after the scan, so
    // one oversized script was read end to end whatever the cap said. The date
    // here sits past the 512 KB budget and must not be reached.
    const padding = 'var noise = "filler filler filler";'.repeat(40_000)
    const doc = documentFrom(
      `<html><body><script>var head = {"published_at":"2019-02-03T00:00:00Z"};${padding}` +
        `var tail = {"published_at":"1999-12-31T00:00:00Z"};</script></body></html>`,
    )

    const found = extractInlineState(doc)
    expect(found.some((c) => c.value.startsWith('2019-02-03'))).toBe(true)
    expect(found.some((c) => c.value.startsWith('1999-12-31'))).toBe(false)
  })

  it('caps the text gathered around an element', () => {
    const doc = documentFrom(
      `<html><body><div><time datetime="2024-03-12">${'x'.repeat(50_000)}</time></div></body></html>`,
    )
    const el = doc.querySelector('time')!

    expect(surroundingText(el).length).toBeLessThanOrEqual(400)
  })
})

describe('malformed candidates cannot make a date unselectable', () => {
  it('ranks an unknown source last instead of returning NaN', () => {
    // `SOURCE_RANK['__proto__']` resolved to an inherited value on a plain
    // object, so the `?? 30` fallback never fired and `rank()` was NaN — which
    // loses every comparison, silently.
    const result = resolveCandidates(
      [
        cand({ value: '2020-01-01T00:00Z', source: '__proto__' }),
        cand({ value: '2020-01-02T00:00Z', source: 'constructor' }),
      ],
      { now: NOW },
    )

    expect(result.published).toBeDefined()
    expect(result.published?.value).toBe('2020-01-01T00:00Z')
  })

  it('does not read a month name off Object.prototype', async () => {
    const { parseDateString } = await import('../src/parse/normalize.js')
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(parseDateString(`12 ${name} 2024`)).toBeNull()
    }
  })
})

describe('discovery will not point the host at its own network', () => {
  /** An `Env` that records every URL asked for and answers nothing. */
  const recordingEnv = (seen: string[]): Env => ({
    fetchText: async (url) => {
      seen.push(url)
      return null
    },
    parseXml: () => null,
  })

  it('refuses a feed link naming a private address', async () => {
    const seen: string[] = []
    const doc = documentFrom(
      `<html><head><link rel="alternate" type="application/rss+xml" href="http://169.254.169.254/latest/meta-data/"></head><body>x</body></html>`,
    )

    await findDates(doc, 'https://example.com/post', recordingEnv(seen), {
      now: NOW,
      sitemap: false,
    })

    expect(seen.some((url) => url.includes('169.254'))).toBe(false)
    // A refused declaration falls back to the well-known probes, which is safe
    // because those are built from the page's own origin rather than from
    // anything the page wrote.
    expect(seen.every((url) => url.startsWith('https://example.com/'))).toBe(true)
  })

  it('refuses a sitemap link naming loopback, and falls back to the well-known path', async () => {
    const seen: string[] = []
    const doc = documentFrom(
      `<html><head><link rel="sitemap" href="http://127.0.0.1:6379/sitemap.xml"></head><body>x</body></html>`,
    )

    await findDates(doc, 'https://example.com/post', recordingEnv(seen), { now: NOW })

    expect(seen.some((url) => url.includes('127.0.0.1'))).toBe(false)
    expect(seen).toContain('https://example.com/sitemap.xml')
  })

  it('still follows a feed on another public host', async () => {
    const seen: string[] = []
    const doc = documentFrom(
      `<html><head><link rel="alternate" type="application/rss+xml" href="https://feeds.feedburner.com/example"></head><body>x</body></html>`,
    )

    await findDates(doc, 'https://example.com/post', recordingEnv(seen), {
      now: NOW,
      sitemap: false,
    })

    expect(seen).toContain('https://feeds.feedburner.com/example')
  })
})

describe('nodeEnv transport policy', () => {
  it('refuses a private address, and a non-web scheme, by default', async () => {
    const { nodeEnv } = await import('../src/node/index.js')
    const env = nodeEnv({ timeoutMs: 1_000 })

    expect(await env.fetchText!('http://169.254.169.254/latest/meta-data/')).toBeNull()
    expect(await env.fetchText!('http://127.0.0.1:1/')).toBeNull()
    expect(await env.fetchText!('file:///etc/passwd')).toBeNull()
  })

  it('serves a loopback dev server when the caller opts out, but never file:', async () => {
    // Analysing your own dev server is ordinary; the opt-out exists so that
    // wanting it does not mean hand-rolling an entire Env.
    const { createServer } = await import('node:http')
    const { nodeEnv } = await import('../src/node/index.js')

    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><head><title>dev</title></head></html>')
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as { port: number }

    try {
      const env = nodeEnv({ timeoutMs: 2_000, blockPrivateNetwork: 'off' })
      expect(await env.fetchText!(`http://127.0.0.1:${port}/`)).toContain('<title>dev</title>')
      // The scheme check survives the opt-out: "fetch this page" never meant
      // "read the local disk".
      expect(await env.fetchText!('file:///etc/passwd')).toBeNull()
    } finally {
      await new Promise<void>((done) => server.close(() => done()))
    }
  })

  it('truncates a response body at the byte cap', async () => {
    const { createServer } = await import('node:http')
    const { nodeEnv } = await import('../src/node/index.js')

    // Chunked, with no content-length, so the cap has to be enforced while
    // reading rather than by believing the header.
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      for (let i = 0; i < 200; i++) res.write('x'.repeat(1024))
      res.end()
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as { port: number }

    try {
      const env = nodeEnv({ timeoutMs: 4_000, blockPrivateNetwork: 'off', maxBytes: 4_096 })
      const body = await env.fetchText!(`http://127.0.0.1:${port}/`)
      expect(body).not.toBeNull()
      expect(body!.length).toBeLessThanOrEqual(4_096)
    } finally {
      await new Promise<void>((done) => server.close(() => done()))
    }
  })

  it('refuses a body whose declared length is over the cap without reading it', async () => {
    const { createServer } = await import('node:http')
    const { nodeEnv } = await import('../src/node/index.js')

    const payload = 'y'.repeat(50_000)
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-length': String(payload.length),
      })
      res.end(payload)
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as { port: number }

    try {
      const env = nodeEnv({ timeoutMs: 4_000, blockPrivateNetwork: 'off', maxBytes: 4_096 })
      expect(await env.fetchText!(`http://127.0.0.1:${port}/`)).toBeNull()
    } finally {
      await new Promise<void>((done) => server.close(() => done()))
    }
  })
})

function cand(over: Partial<Candidate> & { value: string; source: string }): Candidate {
  return {
    field: 'published',
    confidence: 'declared',
    precision: 'minute',
    ...over,
  } as Candidate
}
