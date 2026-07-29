/**
 * An {@link Env} built from web-platform globals alone.
 *
 * `fetch`, `AbortController`, `TextDecoder` and `ReadableStream` exist in Node,
 * in Cloudflare Workers, in Deno, in Bun and in an extension service worker, so
 * the network half of this library has no reason to be Node-only. The redirect
 * walk and the capped read live here rather than inside `nodeEnv` so that
 * `pagedate/edge` is the same code as `pagedate/node` rather than a second
 * implementation free to drift.
 *
 * What is genuinely Node-specific stays behind two injection points:
 * {@link FetchEnvOptions.resolveHostname}, which needs a DNS resolver, and
 * {@link FetchEnvOptions.parseXml}, which needs a DOM implementation. Neither
 * is required, and a runtime that has neither simply gets the guarantees it can
 * actually back.
 */

import type { Env } from './types.js'
import { isSafeFetchTarget } from './extract/urlGuard.js'

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; pagedate/0.1; +https://github.com/mathieutreves/website-date)'

/** Redirect hops followed by hand, so each one can be re-checked. */
const MAX_REDIRECTS = 3

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

export type BlockPrivateNetwork = 'literal' | 'strict' | 'off'

export type FetchEnvOptions = {
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
  /** See the note on this option in `pagedate/node`. Defaults to `'literal'`. */
  blockPrivateNetwork?: BlockPrivateNetwork
  /**
   * Resolve a hostname and report whether every address it answers with is
   * public. Required by, and only by, `blockPrivateNetwork: 'strict'`; without
   * it `'strict'` degrades to `'literal'` rather than pretending to a check it
   * cannot perform.
   */
  resolveHostname?: (hostname: string) => Promise<boolean>
  /**
   * Parse feed and sitemap XML. Defaults to the global `DOMParser` where one
   * exists — browsers, extension service workers and Deno — and to nothing
   * where it does not, which includes Cloudflare Workers and Node.
   *
   * Absent, the XML-backed signals are skipped. That is a supported state, not
   * an error: {@link Env.parseXml} is optional and `findDates` treats a null
   * parse as "no feed here".
   */
  parseXml?: (xml: string) => Document | null
  /**
   * Replace `fetch` itself. For tests, for a runtime whose fetch needs
   * configuring, and for callers routing through a proxy.
   */
  fetch?: typeof globalThis.fetch
}

/**
 * An `Env` backed by real network access.
 *
 * Failures resolve to `null` rather than throwing: a missing feed or a server
 * that refuses HEAD is a normal condition, not an error worth aborting for.
 */
export function fetchEnv(options: FetchEnvOptions = {}): Env {
  const timeoutMs = options.timeoutMs ?? 8000
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const policy = options.blockPrivateNetwork ?? 'literal'
  const doFetch = options.fetch ?? globalThis.fetch

  const allowed = async (url: string): Promise<boolean> => {
    // `file:` and friends are refused whatever the policy: a URL scheme that
    // reads the local disk is never what "fetch this page" meant.
    if (policy === 'off') return hasWebScheme(url)
    if (!isSafeFetchTarget(url)) return false
    if (policy !== 'strict' || !options.resolveHostname) return true
    return await resolvesPublicly(url, options.resolveHostname)
  }

  /**
   * Redirects are followed by hand rather than by `fetch`.
   *
   * `redirect: 'follow'` checks the URL we chose and then goes wherever the
   * server sends it, which hands the redirect target the same power the
   * `<link>` tag had — a public URL answering `302 Location:
   * http://169.254.169.254/` walks straight through a guard applied only to the
   * first hop. Node's fetch and the Workers runtime, unlike a browser's, expose
   * the 3xx response and its headers, so re-checking each hop is cheap.
   */
  const request = async (url: string, method: 'GET' | 'HEAD'): Promise<Response | null> => {
    let target = url

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await allowed(target))) return null

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let response: Response
      try {
        response = await doFetch(target, {
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
  }

  const parseXml = options.parseXml ?? globalDomParser()
  if (parseXml) env.parseXml = parseXml
  if (options.now) env.now = options.now

  return env
}

/**
 * The platform `DOMParser`, where there is one.
 *
 * Resolved once per `fetchEnv` call rather than per parse, and off the global
 * rather than imported, because the whole point is that this module names no
 * DOM implementation.
 */
function globalDomParser(): ((xml: string) => Document | null) | null {
  const Parser = (globalThis as { DOMParser?: new () => DOMParser }).DOMParser
  if (!Parser) return null
  return (xml) => {
    try {
      return new Parser().parseFromString(xml, 'text/xml')
    } catch {
      return null
    }
  }
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
export async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
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
async function resolvesPublicly(
  url: string,
  resolveHostname: (hostname: string) => Promise<boolean>,
): Promise<boolean> {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }

  // Literals were already judged by `isSafeFetchTarget`; there is nothing to
  // resolve and a lookup would just hand the same string back.
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true

  try {
    return await resolveHostname(host)
  } catch {
    // A name that will not resolve is not a name worth fetching.
    return false
  }
}
