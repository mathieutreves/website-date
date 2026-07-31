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
import { fetchEnv, type FetchEnvOptions } from '../fetchEnv.js'
import type { ResolveOptions } from '../resolve.js'

export type { Candidate, DateResult, Env, Confidence, Conflict, Field, Precision } from '../types.js'
export { extractFromDocument, resolve, findDates } from '../index.js'
export { parseDateString, toInstant } from '../parse/normalize.js'
export { isStale, staleness, toInterval } from '../staleness.js'
export type {
  IsStaleOptions,
  Staleness,
  StalenessBasis,
  StalenessOptions,
  StalenessReason,
} from '../staleness.js'

/**
 * Largest HTML string parsed, in characters. Documents above this are truncated.
 *
 * Every date this library looks for is metadata in `<head>` or content near the
 * top of the body, so the tail of a very large document is the part least likely
 * to hold the answer — and the part most likely to be padding. Truncating rather
 * than throwing keeps a partial page answerable, which is the same trade the
 * capped body read in `fetchEnv` makes.
 */
const DEFAULT_MAX_HTML = 10 * 1024 * 1024

/**
 * Raw-text elements whose tag name is lowercased before parsing.
 *
 * Works around a bug in node-html-parser 9.0.0: when a raw-text element's
 * opening and closing tag differ in case — `<SCRIPT …>` closed by `</script>`,
 * which is how a lot of pre-2013 markup is written — the parser never finds the
 * close and consumes the rest of the document as script content. Minimal repro:
 *
 * ```html
 * <SCRIPT>var a=1;</script><p>after</p>   // <p> is lost
 * <script>var a=1;</SCRIPT><p>after</p>   // <p> is lost
 * ```
 *
 * Matching case parses correctly in either case, so it is the mismatch and not
 * the uppercase that breaks it. HTML tag names are case-insensitive, so this is
 * a spec violation; linkedom handles all four spellings.
 *
 * It is not a rounding error. `techtarget.com` gives 65 kB of HTML that becomes
 * **three elements**, and the extractors then correctly report no date on a page
 * that has one. Across the corpus, 14 of 4131 documents over 5 kB (0.34%) parse
 * into fewer than 20 elements, and 8 of 4215 resolve to a different date than
 * linkedom — every one of them a page added in the Tranco harvest, which is why
 * a parity check that had passed for a year started failing.
 *
 * Only the tag name is rewritten, never attributes or content, so the bytes the
 * extractors read are unchanged apart from the spelling of four tag names.
 */
const RAW_TEXT_TAG = /<(\/?)(script|style|textarea|title)\b/gi

/** Parse an HTML string into a Document the extractors can read. */
export function parseHtml(html: string, maxLength: number = DEFAULT_MAX_HTML): Document {
  const capped = html.length > maxLength ? html.slice(0, maxLength) : html
  const normalised = capped.replace(RAW_TEXT_TAG, (_m, slash: string, tag: string) =>
    `<${slash}${tag.toLowerCase()}`,
  )
  return parseNodeHtml(normalised) as unknown as Document
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

/**
 * An `Env` backed by real network access.
 *
 * The transport — redirect walk, timeout, capped read — is
 * {@link fetchEnv}, shared with `pagedate/edge` so that the two cannot drift.
 * What is added here is the two things only Node can supply: a DNS resolver to
 * back `blockPrivateNetwork: 'strict'`, and linkedom as an XML parser, since
 * Node has no global `DOMParser` for `fetchEnv` to find.
 *
 * Failures resolve to `null` rather than throwing: a missing feed or a server
 * that refuses HEAD is a normal condition, not an error worth aborting for.
 */
export function nodeEnv(options: NodeEnvOptions = {}): Env {
  const forwarded: FetchEnvOptions = { ...options, resolveHostname }

  const parseXml = (xml: string): Document | null => {
    const Parser = xmlParser()
    if (!Parser) return null
    try {
      return new Parser().parseFromString(xml, 'text/xml') as unknown as Document
    } catch {
      return null
    }
  }
  forwarded.parseXml = parseXml

  return fetchEnv(forwarded)
}

/**
 * Resolve a hostname and report whether every address it answers with is
 * public. Passed to {@link fetchEnv}, which owns the decision about when to
 * call it.
 *
 * `createRequire` rather than a static import so that a bundler targeting a
 * non-Node runtime does not pull `node:dns` in on the strength of a path that
 * only `blockPrivateNetwork: 'strict'` reaches.
 */
async function resolveHostname(host: string): Promise<boolean> {
  const { lookup } = createRequire(import.meta.url)(
    'node:dns/promises',
  ) as typeof import('node:dns/promises')
  const results = await lookup(host, { all: true })
  return results.every(({ address, family }) =>
    isSafeFetchTarget(family === 6 ? `http://[${address}]/` : `http://${address}/`),
  )
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
