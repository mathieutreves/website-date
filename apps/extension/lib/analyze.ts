import { extractFromDocument, resolve, type DateResult, type Env } from 'pagedate'
import { fetchArchive } from './archive.js'

/**
 * The read-extract-resolve-cache pipeline, shared by the popup and the
 * background worker.
 *
 * These two ran the same sequence in two places before the badge existed, which
 * is how a popup and a badge end up disagreeing about the same page.
 */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Bump to invalidate every cached result after a heuristics change.
 * 2: extraction changed; cached results from v1 may disagree with a fresh run.
 */
const CACHE_VERSION = 2

export type CacheEntry = { result: DateResult; fetchedAt: number; version: number }

export const cacheKey = (url: string): string => `d:${url}`

export const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Network access for feed lookup.
 *
 * Same-origin only. `activeTab` grants host permission for the current tab's
 * origin — which is exactly where a site's feed lives — so this works without
 * ever requesting <all_urls>. Cross-origin requests are refused, not attempted.
 */
export function pageEnv(pageUrl: string): Env {
  const origin = originOf(pageUrl)

  return {
    fetchText: async (url) => {
      if (originOf(url) !== origin) return null
      try {
        const response = await fetch(url, { credentials: 'omit' })
        return response.ok ? await response.text() : null
      } catch {
        return null
      }
    },
    parseXml: (xml) => {
      const parsed = new DOMParser().parseFromString(xml, 'application/xml')
      return parsed.querySelector('parsererror') ? null : parsed
    },
  }
}

/** Read the live DOM as HTML. Reflects the hydrated page, so SPAs work. */
export async function readPageHtml(tabId: number): Promise<string | null> {
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement.outerHTML,
    })
    return typeof injection?.result === 'string' ? injection.result : null
  } catch {
    return null
  }
}

export async function readCache(url: string): Promise<DateResult | null> {
  try {
    const key = cacheKey(url)
    const stored = await browser.storage.local.get(key)
    const entry = stored[key] as CacheEntry | undefined
    if (!entry || entry.version !== CACHE_VERSION) return null
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null
    return entry.result
  } catch {
    return null
  }
}

export async function writeCache(url: string, result: DateResult): Promise<void> {
  try {
    const entry: CacheEntry = { result, fetchedAt: Date.now(), version: CACHE_VERSION }
    await browser.storage.local.set({ [cacheKey(url)]: entry })
  } catch {
    // Storage full or unavailable — the result is still shown, just not cached.
  }
}

export type Analysis = { result: DateResult; fromCache: boolean } | { error: 'unreadable' }

export type AnalyzeOptions = {
  /** Ask the Internet Archive about edits the page does not admit to. */
  withArchive?: boolean
}

export async function analyze(
  tabId: number,
  url: string,
  options: AnalyzeOptions = {},
): Promise<Analysis> {
  const cached = await readCache(url)
  // A cached result was resolved without the archive. Asking for it now is a
  // different question, so the cache is bypassed rather than answered stale.
  if (cached && !options.withArchive) return { result: cached, fromCache: true }

  const html = await readPageHtml(tabId)
  if (html === null) return { error: 'unreadable' }

  const archive = options.withArchive ? await fetchArchive(url) : null

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const result = await resolve(
    extractFromDocument(doc, url),
    url,
    pageEnv(url),
    archive?.lastEdit ? { archiveLastEdit: archive.lastEdit } : {},
  )

  await writeCache(url, result)
  return { result, fromCache: false }
}

/** How much of `storage.local` the result cache is using, for the options page. */
export async function cacheStats(): Promise<{ count: number; bytes: number }> {
  try {
    const all = await browser.storage.local.get(null)
    const entries = Object.entries(all).filter(([key]) => key.startsWith('d:'))
    return {
      count: entries.length,
      bytes: entries.reduce((sum, entry) => sum + JSON.stringify(entry).length, 0),
    }
  } catch {
    return { count: 0, bytes: 0 }
  }
}

export async function clearCache(): Promise<void> {
  const all = await browser.storage.local.get(null)
  const keys = Object.keys(all).filter((key) => key.startsWith('d:'))
  if (keys.length > 0) await browser.storage.local.remove(keys)
}
