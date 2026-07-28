/**
 * Node entry point — `pagedate/node`.
 *
 * The core package deliberately ships no HTML parser: in a browser or an
 * extension content script the DOM already exists, and bundling a parser there
 * would be dead weight. Server-side callers have no DOM, so this subpath adds
 * one plus a real network implementation.
 *
 * `linkedom` is an optional peer dependency. Browser and extension consumers
 * never resolve this module and never install it.
 */

import { DOMParser, parseHTML } from 'linkedom'
import type { DateResult, Env } from '../types.js'
import { findDates, resolve, extractFromDocument, type ExtractOptions } from '../index.js'
import type { ResolveOptions } from '../resolve.js'

export type { Candidate, DateResult, Env, Confidence, Conflict, Field, Precision } from '../types.js'
export { extractFromDocument, resolve, findDates } from '../index.js'
export { parseDateString, toInstant } from '../parse/normalize.js'

const USER_AGENT =
  'Mozilla/5.0 (compatible; pagedate/0.1; +https://github.com/mathieutreves/website-date)'

/** Parse an HTML string into a Document the extractors can read. */
export function parseHtml(html: string): Document {
  const { document } = parseHTML(html)
  return document as unknown as Document
}

export type NodeEnvOptions = {
  /** Milliseconds before a request is abandoned. Defaults to 8000. */
  timeoutMs?: number
  userAgent?: string
  /** Fixed clock, for reproducible runs. */
  now?: () => Date
}

/**
 * An `Env` backed by real network access.
 *
 * Failures resolve to `null` rather than throwing: a missing feed or a server
 * that refuses HEAD is a normal condition, not an error worth aborting for.
 */
export function nodeEnv(options: NodeEnvOptions = {}): Env {
  const timeoutMs = options.timeoutMs ?? 8000
  const userAgent = options.userAgent ?? USER_AGENT

  const request = async (url: string, method: 'GET' | 'HEAD'): Promise<Response | null> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method,
        headers: { 'user-agent': userAgent, accept: '*/*' },
        redirect: 'follow',
        signal: controller.signal,
      })
      return response.ok ? response : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  const env: Env = {
    fetchText: async (url) => {
      const response = await request(url, 'GET')
      return response ? await response.text() : null
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
      try {
        return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
      } catch {
        return null
      }
    },
  }

  if (options.now) env.now = options.now

  return env
}

export type FromHtmlOptions = ResolveOptions & ExtractOptions & {
  /** Set to enable feed lookup, which needs network access. */
  env?: Env
}

/** Extract dates from an HTML string. Offline unless an `env` is supplied. */
export async function findDatesFromHtml(
  html: string,
  url: string,
  options: FromHtmlOptions = {},
): Promise<DateResult> {
  const { env, ...resolveOptions } = options
  const doc = parseHtml(html)

  // Without an env there is no network, so the feed path is skipped and this
  // reduces to pure DOM extraction.
  if (!env) return resolve(extractFromDocument(doc, url, options), url, {}, resolveOptions)
  return findDates(doc, url, env, resolveOptions)
}

export type FromUrlOptions = ResolveOptions & ExtractOptions &
  NodeEnvOptions & {
    /** Supply your own Env to override the default network implementation. */
    env?: Env
  }

/**
 * Fetch a page and extract its dates, including feed lookup.
 *
 * Returns `null` only when the page itself could not be fetched.
 */
export async function findDatesFromUrl(
  url: string,
  options: FromUrlOptions = {},
): Promise<DateResult | null> {
  const { env: providedEnv, timeoutMs, userAgent, now, ...resolveOptions } = options

  const envOptions: NodeEnvOptions = {}
  if (timeoutMs !== undefined) envOptions.timeoutMs = timeoutMs
  if (userAgent !== undefined) envOptions.userAgent = userAgent
  if (now !== undefined) envOptions.now = now

  const env = providedEnv ?? nodeEnv(envOptions)

  const html = await env.fetchText?.(url)
  if (!html) return null

  return findDates(parseHtml(html), url, env, resolveOptions)
}
