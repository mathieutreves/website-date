import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { findDates, webEnv } from '../src/edge/index.js'
import { documentFrom, NOW } from './helpers.js'

/**
 * `pagedate/edge` is a promise about what it does *not* contain, so most of what
 * is worth testing is absence. The behavioural half is covered by node.test.ts
 * already — `webEnv` and `nodeEnv` are the same `fetchEnv` — so what is here is
 * the part that differs: that it runs with no Node globals in reach, and that
 * the two documented degradations degrade rather than throw.
 */

const PAGE = `
  <html lang="en"><head>
    <link rel="alternate" type="application/atom+xml" href="/feed.xml">
  </head><body><article><h1>A post</h1></article></body></html>`

const FEED = `<?xml version="1.0"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <link href="https://example.com/posts/thing"/>
      <published>2024-03-12T09:30:00Z</published>
    </entry>
  </feed>`

const URL_ = 'https://example.com/posts/thing'

/** A `fetch` that serves a fixed map and refuses everything else. */
const stubFetch = (routes: Record<string, string>): typeof globalThis.fetch =>
  (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = routes[url]
    if (body === undefined) return new Response('', { status: 404 })
    return new Response(body, { status: 200 })
  }) as typeof globalThis.fetch

describe('webEnv', () => {
  it('fetches through the injected fetch', async () => {
    const env = webEnv({ fetch: stubFetch({ [URL_]: 'hello' }) })
    expect(await env.fetchText!(URL_)).toBe('hello')
  })

  it('still blocks private addresses', async () => {
    const env = webEnv({ fetch: stubFetch({ 'http://169.254.169.254/': 'secrets' }) })
    expect(await env.fetchText!('http://169.254.169.254/')).toBeNull()
  })

  it('still refuses a non-web scheme', async () => {
    const env = webEnv({ fetch: stubFetch({}) })
    expect(await env.fetchText!('file:///etc/passwd')).toBeNull()
  })

  /*
   * The documented degradation. Without a resolver there is no DNS to consult,
   * and the contract is that `'strict'` falls back to the literal-address check
   * rather than throwing or — far worse — silently allowing everything.
   */
  it('strict without a resolver degrades to literal rather than failing', async () => {
    const env = webEnv({
      blockPrivateNetwork: 'strict',
      fetch: stubFetch({ 'https://example.com/': 'ok', 'http://127.0.0.1/': 'no' }),
    })

    expect(await env.fetchText!('https://example.com/')).toBe('ok')
    expect(await env.fetchText!('http://127.0.0.1/')).toBeNull()
  })

  it('uses a resolver when one is supplied', async () => {
    const env = webEnv({
      blockPrivateNetwork: 'strict',
      resolveHostname: async (host) => host !== 'internal.example.com',
      fetch: stubFetch({
        'https://example.com/': 'ok',
        'https://internal.example.com/': 'no',
      }),
    })

    expect(await env.fetchText!('https://example.com/')).toBe('ok')
    expect(await env.fetchText!('https://internal.example.com/')).toBeNull()
  })

  /*
   * The other documented degradation: Cloudflare Workers has no global
   * DOMParser, so the XML-backed signals go missing. The page must still
   * resolve from what it declares itself.
   */
  it('omits parseXml when the runtime has no DOMParser', () => {
    const saved = (globalThis as { DOMParser?: unknown }).DOMParser
    delete (globalThis as { DOMParser?: unknown }).DOMParser
    try {
      expect(webEnv().parseXml).toBeUndefined()
    } finally {
      if (saved) (globalThis as { DOMParser?: unknown }).DOMParser = saved
    }
  })

  it('accepts an injected parseXml and finds the feed with it', async () => {
    const { DOMParser } = await import('linkedom')
    const env = webEnv({
      fetch: stubFetch({ 'https://example.com/feed.xml': FEED }),
      parseXml: (xml) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document,
      now: () => NOW,
    })

    const result = await findDates(documentFrom(PAGE), URL_, env)
    expect(result.published?.value).toBe('2024-03-12T09:30Z')
    expect(result.published?.source).toBe('atom-feed')
  })

  it('skips the feed rather than throwing when no parser is available', async () => {
    const env = webEnv({
      fetch: stubFetch({ 'https://example.com/feed.xml': FEED }),
      now: () => NOW,
    })
    delete (env as { parseXml?: unknown }).parseXml

    const result = await findDates(documentFrom(PAGE), URL_, env)
    expect(result.published).toBeUndefined()
    expect(result.candidates).toEqual([])
  })
})

/**
 * The assertion the whole subpath exists for.
 *
 * Run against `src` rather than `dist` so it fails in the editor and on a plain
 * `pnpm test`, with no build step in between. It walks the real import graph, so
 * a `node:` import added three modules deep — which is how this would actually
 * regress — is caught at the module that introduced it.
 */
describe('bundle purity', () => {
  const NODE_IMPORT = /from\s+['"]node:|require\(\s*['"]node:|import\(\s*['"]node:/

  async function reachableFrom(entry: string): Promise<Map<string, string>> {
    const seen = new Map<string, string>()
    const queue = [entry]

    while (queue.length > 0) {
      const path = queue.pop()!
      if (seen.has(path)) continue
      const source = await readFile(path, 'utf8')
      seen.set(path, source)

      for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const specifier = match[1]!
        const dir = path.slice(0, path.lastIndexOf('/'))
        // Written as ESM `.js` specifiers; the file on disk is `.ts`.
        queue.push(new URL(specifier.replace(/\.js$/, '.ts'), `file://${dir}/`).pathname)
      }
    }

    return seen
  }

  it('reaches no node: import from the edge entry', async () => {
    const graph = await reachableFrom(new URL('../src/edge/index.ts', import.meta.url).pathname)
    const offenders = [...graph].filter(([, source]) => NODE_IMPORT.test(source)).map(([path]) => path)

    expect(offenders).toEqual([])
    // Guards the guard: a traversal that silently resolved nothing would also
    // report no offenders.
    expect(graph.size).toBeGreaterThan(15)
  })

  it('reaches no bare (non-relative) import either', async () => {
    const graph = await reachableFrom(new URL('../src/edge/index.ts', import.meta.url).pathname)
    const bare = [...graph].flatMap(([path, source]) =>
      [...source.matchAll(/^import\s[^'"]*from\s+['"]([^.'"][^'"]*)['"]/gm)].map(
        (m) => `${path}: ${m[1]}`,
      ),
    )

    // Zero runtime dependencies is the package's headline claim; on an edge
    // runtime it is also load-bearing, because there is no node_modules to fall
    // back on if it stops being true.
    expect(bare).toEqual([])
  })

  it('the node entry, by contrast, does use node: imports', async () => {
    // Confirms the test above is measuring something: the same walker over the
    // Node entry must find what it is designed to find.
    const graph = await reachableFrom(new URL('../src/node/index.ts', import.meta.url).pathname)
    expect([...graph].some(([, source]) => NODE_IMPORT.test(source))).toBe(true)
  })
})
