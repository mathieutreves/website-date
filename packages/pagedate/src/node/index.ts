/**
 * Node entry point — `pagedate/node`.
 *
 * The core package deliberately ships no HTML parser: in a browser or an
 * extension content script the DOM already exists, and bundling a parser there
 * would be dead weight. Server-side callers have no DOM, so this subpath adds
 * one plus a real network implementation.
 *
 * Two parsers, for two jobs, because no one library does both well:
 *
 *  - **HTML** is parsed by `node-html-parser`, which is ~2.5x faster than
 *    linkedom and, once the extractors stopped assuming `parentElement` and
 *    `documentElement`, answers identically: 435/435 pages on the local corpus
 *    and 55/55 on htmldate's, matching on published value, source, modified
 *    value and candidate set alike. It is the whole reason the Node path costs
 *    ~7 ms rather than ~14.
 *  - **XML** stays with linkedom, and has to. `node-html-parser` applies HTML
 *    void-element rules to `<link>`, so an RSS `<link>https://…</link>` parses
 *    as empty and the URL leaks out as a sibling — 209 silently emptied field
 *    reads across the fixtures, which is exactly how a feed stops matching the
 *    page it describes.
 *
 * Both are optional peer dependencies, and linkedom is loaded only when an XML
 * document is actually parsed: a caller who never touches feeds or sitemaps
 * never needs it installed.
 */

import { parse as parseNodeHtml } from 'node-html-parser'
import { createRequire } from 'node:module'
import type { DateResult, Env } from '../types.js'
import {
  findDates,
  resolve,
  extractFromDocument,
  type ExtractOptions,
  type NetworkOptions,
} from '../index.js'
import { isSafeFetchTarget } from '../extract/urlGuard.js'
import type { ResolveOptions } from '../resolve.js'

export type { Candidate, DateResult, Env, Confidence, Conflict, Field, Precision } from '../types.js'
export { extractFromDocument, resolve, findDates } from '../index.js'
export { parseDateString, toInstant } from '../parse/normalize.js'

const USER_AGENT =
  'Mozilla/5.0 (compatible; pagedate/0.1; +https://github.com/mathieutreves/website-date)'

/**
 * Largest HTML string parsed, in characters. Documents above this are truncated.
 *
 * Every date this library looks for is metadata in `<head>` or content near the
 * top of the body, so the tail of a very large document is the part least likely
 * to hold the answer — and the part most likely to be padding. Truncating rather
 * than throwing keeps a partial page answerable, which is the same trade
 * {@link readCapped} makes.
 */
const DEFAULT_MAX_HTML = 10 * 1024 * 1024

/** Parse an HTML string into a Document the extractors can read. */
export function parseHtml(html: string, maxLength: number = DEFAULT_MAX_HTML): Document {
  return parseNodeHtml(html.length > maxLength ? html.slice(0, maxLength) : html) as unknown as Document
}

/**
 * linkedom's `DOMParser`, resolved on first use.
 *
 * Required synchronously because {@link Env.parseXml} is synchronous, so a
 * dynamic `import()` cannot be awaited here. `undefined` means "not yet looked
 * up", `null` means "looked up and absent" — which is a supported state, not an
 * error: {@link defaultParseXml} already treats a missing parser as "the XML
 * paths do not run".
 */
let XmlParser: (new () => DOMParser) | null | undefined

function xmlParser(): (new () => DOMParser) | null {
  if (XmlParser !== undefined) return XmlParser
  let resolved: (new () => DOMParser) | null = null
  try {
    resolved = createRequire(import.meta.url)('linkedom').DOMParser as new () => DOMParser
  } catch {
    resolved = null
  }
  XmlParser = resolved
  return resolved
}

export type NodeEnvOptions = {
  /** Milliseconds before a request is abandoned. Defaults to 8000. */
  timeoutMs?: number
  userAgent?: string
  /** Fixed clock, for reproducible runs. */
  now?: () => Date
  /**
   * Largest response body read, in bytes. Defaults to 5 MB.
   *
   * A timeout alone does not bound memory: a server that answers slowly but
   * steadily stays inside the deadline the whole time it is filling the heap.
   */
  maxBytes?: number
  /**
   * How hard to work at not connecting to the private network. Defaults to
   * `'literal'`.
   *
   * `'literal'` blocks non-HTTP schemes and private, loopback, link-local and
   * metadata *addresses*, on the original URL and on every redirect hop.
   *
   * `'strict'` additionally resolves each hostname and refuses it if any
   * answer is a private address. This is a preflight, not a pin: a resolver
   * that returns a public address here and a private one when the connection
   * is actually made — DNS rebinding — defeats it. Closing that needs the
   * socket to connect to the address that was checked, which means an
   * `undici` `Agent` with a custom `connect.lookup`, and a dependency this
   * package does not have. On a genuinely hostile network, inject your own
   * `Env`.
   *
   * `'off'` removes the address check entirely, leaving only the scheme test.
   * Analysing `http://localhost:3000/` against your own dev server is a
   * perfectly ordinary thing to want, and the alternative — hand-rolling an
   * entire `Env` to get it — would push people away from the guarded path for
   * an unrelated reason. Do not set it for URLs you did not choose.
   */
  blockPrivateNetwork?: 'literal' | 'strict' | 'off'
}

/** Redirect hops followed by hand, so each one can be re-checked. */
const MAX_REDIRECTS = 3

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

/**
 * An `Env` backed by real network access.
 *
 * Failures resolve to `null` rather than throwing: a missing feed or a server
 * that refuses HEAD is a normal condition, not an error worth aborting for.
 */
export function nodeEnv(options: NodeEnvOptions = {}): Env {
  const timeoutMs = options.timeoutMs ?? 8000
  const userAgent = options.userAgent ?? USER_AGENT
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const policy = options.blockPrivateNetwork ?? 'literal'

  const allowed = async (url: string): Promise<boolean> => {
    // `file:` and friends are refused whatever the policy: a URL scheme that
    // reads the local disk is never what "fetch this page" meant.
    if (policy === 'off') return hasWebScheme(url)
    if (!isSafeFetchTarget(url)) return false
    return policy === 'strict' ? await resolvesPublicly(url) : true
  }

  /**
   * Redirects are followed by hand rather than by `fetch`.
   *
   * `redirect: 'follow'` checks the URL we chose and then goes wherever the
   * server sends it, which hands the redirect target the same power the
   * `<link>` tag had — a public URL answering `302 Location:
   * http://169.254.169.254/` walks straight through a guard applied only to the
   * first hop. Node's fetch, unlike a browser's, exposes the 3xx response and
   * its headers, so re-checking each hop is cheap.
   */
  const request = async (url: string, method: 'GET' | 'HEAD'): Promise<Response | null> => {
    let target = url

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await allowed(target))) return null

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let response: Response
      try {
        response = await fetch(target, {
          method,
          headers: { 'user-agent': userAgent, accept: '*/*' },
          redirect: 'manual',
          signal: controller.signal,
        })
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }

      if (response.status < 300 || response.status > 399) return response.ok ? response : null

      const location = response.headers.get('location')
      if (!location) return null
      try {
        target = new URL(location, target).toString()
      } catch {
        return null
      }
    }

    // Out of hops. A redirect chain this long is either a loop or a server
    // trying to outlast the check, and neither is worth another request.
    return null
  }

  const env: Env = {
    fetchText: async (url) => {
      const response = await request(url, 'GET')
      return response ? await readCapped(response, maxBytes) : null
    },
    fetchHeaders: async (url) => {
      const response = await request(url, 'HEAD')
      if (!response) return null
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })
      return headers
    },
    parseXml: (xml) => {
      const Parser = xmlParser()
      if (!Parser) return null
      try {
        return new Parser().parseFromString(xml, 'text/xml') as unknown as Document
      } catch {
        return null
      }
    },
  }

  if (options.now) env.now = options.now

  return env
}

/**
 * Read a response body, stopping at `maxBytes`.
 *
 * `response.text()` reads whatever arrives, and the abort timer does not help:
 * a server drip-feeding inside the deadline fills the heap without ever being
 * slow enough to cancel. Truncation beats rejection here — the signals this
 * library reads out of a feed or sitemap sit near the top of the document, so a
 * capped read usually still answers, and a partial answer beats an exception.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  // The cheap check first: a server that declares an oversized body is taken at
  // its word rather than being streamed to find out.
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null

  const body = response.body
  if (!body) return await response.text()

  const decoder = new TextDecoder('utf-8')
  const reader = body.getReader()
  let out = ''
  let read = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      const remaining = maxBytes - read
      if (value.byteLength >= remaining) {
        out += decoder.decode(value.subarray(0, remaining))
        break
      }
      read += value.byteLength
      out += decoder.decode(value, { stream: true })
    }
  } catch {
    return out === '' ? null : out
  } finally {
    // Releases the socket rather than leaving the rest of an oversized body
    // streaming into a reader nobody is draining.
    await reader.cancel().catch(() => {})
  }

  return out
}

/** The one check `blockPrivateNetwork: 'off'` still keeps. */
function hasWebScheme(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Does every address this hostname resolves to sit on the public internet?
 *
 * Used only by `blockPrivateNetwork: 'strict'`. See the caveat on that option:
 * this closes "a public name pointing at 127.0.0.1", not "a name that answers
 * differently the second time it is asked".
 */
async function resolvesPublicly(url: string): Promise<boolean> {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }

  // Literals were already judged by `isSafeFetchTarget`; there is nothing to
  // resolve and `lookup` would just hand the same string back.
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true

  try {
    const { lookup } = createRequire(import.meta.url)('node:dns/promises') as typeof import('node:dns/promises')
    const results = await lookup(host, { all: true })
    return results.every(({ address, family }) =>
      isSafeFetchTarget(family === 6 ? `http://[${address}]/` : `http://${address}/`),
    )
  } catch {
    // A name that will not resolve is not a name worth fetching.
    return false
  }
}

export type FromHtmlOptions = ResolveOptions & ExtractOptions & NetworkOptions & {
  /** Set to enable the feed and sitemap lookups, which need network access. */
  env?: Env
  /** Characters of HTML parsed before the document is truncated. Defaults to 10 MB. */
  maxHtmlLength?: number
}

/** Extract dates from an HTML string. Offline unless an `env` is supplied. */
export async function findDatesFromHtml(
  html: string,
  url: string,
  options: FromHtmlOptions = {},
): Promise<DateResult> {
  const { env, maxHtmlLength, ...resolveOptions } = options
  const doc = parseHtml(html, maxHtmlLength)

  // Without an env there is no network, so the feed path is skipped and this
  // reduces to pure DOM extraction.
  if (!env) return resolve(extractFromDocument(doc, url, options), url, {}, resolveOptions)
  return findDates(doc, url, env, resolveOptions)
}

export type FromUrlOptions = ResolveOptions & ExtractOptions & NetworkOptions &
  NodeEnvOptions & {
    /** Supply your own Env to override the default network implementation. */
    env?: Env
    /** Characters of HTML parsed before the document is truncated. Defaults to 10 MB. */
    maxHtmlLength?: number
  }

/**
 * Fetch a page and extract its dates, including feed lookup.
 *
 * Returns `null` only when the page itself could not be fetched — which now
 * includes refusing to fetch it: `url` goes through the same address filter as
 * every other request, so pointing this at `http://localhost:8080/` returns
 * `null` rather than reading it. Callers who legitimately analyse pages on their
 * own network should pass their own `env`.
 */
export async function findDatesFromUrl(
  url: string,
  options: FromUrlOptions = {},
): Promise<DateResult | null> {
  const {
    env: providedEnv,
    timeoutMs,
    userAgent,
    now,
    maxBytes,
    blockPrivateNetwork,
    maxHtmlLength,
    ...resolveOptions
  } = options

  const envOptions: NodeEnvOptions = {}
  if (timeoutMs !== undefined) envOptions.timeoutMs = timeoutMs
  if (userAgent !== undefined) envOptions.userAgent = userAgent
  if (now !== undefined) envOptions.now = now
  if (maxBytes !== undefined) envOptions.maxBytes = maxBytes
  if (blockPrivateNetwork !== undefined) envOptions.blockPrivateNetwork = blockPrivateNetwork

  const env = providedEnv ?? nodeEnv(envOptions)

  const html = await env.fetchText?.(url)
  if (!html) return null

  return findDates(parseHtml(html, maxHtmlLength), url, env, resolveOptions)
}
