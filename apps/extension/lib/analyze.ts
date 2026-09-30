import { resolve, type Candidate, type DateResult } from 'pagedate'
import { fetchArchive } from './archive.js'
import { readCache, writeCache } from './cache.js'
import { PAGE_READ_GLOBAL, type PageRead } from './page-read.js'

/**
 * The read-extract-resolve-cache pipeline, shared by the popup and the
 * background worker.
 *
 * One implementation, deliberately: the same sequence written out in two places
 * is how a popup and a badge end up disagreeing about the same page.
 */

export {
  cacheKey,
  cacheStats,
  clearCache,
  dropCache,
  pruneCache,
  readCache,
  writeCache,
  type CacheEntry,
} from './cache.js'

export const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/*
 * No `Env` is built here, and its absence is deliberate rather than an omission.
 *
 * The extension resolves with `resolve()`, not `findDates()`, so it collects no
 * network signals: no feed, no sitemap, no `Last-Modified`. `resolve` is pure —
 * it ranks the candidates it is handed and fetches nothing — so a `fetchText`
 * or `parseXml` supplied here would never be called, and would read as a
 * capability the extension has when it does not.
 *
 * Adding feed lookup is a deliberate change, not a missing line: it costs a
 * request per page, and it needs an XML parser somewhere with a DOM, which the
 * service worker does not have.
 */

/**
 * Built by WXT from `entrypoints/extract.ts`.
 *
 * Root-relative, with the leading slash WXT's `ScriptPublicPath` requires. The
 * browser resolves both spellings against the extension root, so this is a type
 * constraint rather than a behavioural one — but a bare name stops typechecking.
 */
const EXTRACT_SCRIPT = '/extract.js'

/**
 * Extract from the live DOM, in the tab, and bring back only the candidates.
 *
 * Reads the hydrated page, so SPAs work, without moving the document anywhere
 * to get at it.
 *
 * Two injections rather than one, and the second is the cheap half: the first
 * runs the extractor and stashes its result, the second reads that result back.
 * The alternative — trusting what `executeScript({ files })` resolves to —
 * depends on the module format the bundler emitted, which is not a contract
 * anything here should rest on. See {@link PAGE_READ_GLOBAL}.
 *
 * Both land in the same isolated world, so the second call sees what the first
 * left. Neither is visible to the page.
 */
export async function readPage(
  tabId: number,
  expectedUrl?: string,
): Promise<{ candidates: Candidate[]; soft: boolean } | null> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [EXTRACT_SCRIPT] })

    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      // The key is passed in rather than closed over: this function is
      // serialised to source and evaluated in the page's world, where nothing
      // from this module exists.
      func: (key: string) => (globalThis as unknown as Record<string, unknown>)[key],
      args: [PAGE_READ_GLOBAL],
    })

    const candidates = acceptPageRead(injection?.result, expectedUrl)
    return candidates && { candidates, soft: isSoftNavigated(injection?.result) }
  } catch {
    return null
  }
}

/**
 * Decide whether an injection result is a page read worth trusting.
 *
 * Split out from {@link readPage} so the judgement can be tested
 * without a browser: what arrives here is whatever `executeScript` resolved to,
 * which is `undefined` on a frame that refused injection, and stale on the
 * single-page-app race the `expectedUrl` guard exists for.
 *
 * `candidates` is checked for being an array rather than trusted from its type.
 * The value crossed a structured-clone boundary from a script running in a page
 * we do not control, and `PageRead` is an assertion about it, not a fact.
 */
export function acceptPageRead(result: unknown, expectedUrl?: string): Candidate[] | null {
  const read = result as PageRead | undefined
  if (!read || typeof read !== 'object') return null
  if (!Array.isArray(read.candidates) || typeof read.href !== 'string') return null
  if (expectedUrl && !sameDocument(read.href, expectedUrl)) return null
  return read.candidates
}

/**
 * Was this read taken from a document that has changed route since it loaded?
 *
 * The `expectedUrl` guard above catches a read that raced the URL. It cannot
 * catch the other half of the same race: on `pushState` the URL changes
 * *first*, so `location.href` already matches while the JSON-LD and meta tags
 * in the head still describe the previous route — and on some single-page apps
 * they are never rewritten at all. Such a read passes every check and is about
 * the wrong page.
 *
 * It cannot be told apart from a correct one by looking at it, so the rule is
 * about where it came from: a document whose address is no longer the one it
 * was loaded at is shown, and not remembered. A missing `loaded` — a browser
 * that does not report it — is not evidence either way, and is left to the
 * caller's own knowledge of how the read was triggered.
 */
export function isSoftNavigated(result: unknown): boolean {
  const read = result as PageRead | undefined
  if (!read || typeof read !== 'object') return false
  if (typeof read.loaded !== 'string' || typeof read.href !== 'string') return false
  return !sameDocument(read.loaded, read.href)
}

/**
 * Compare ignoring the fragment: `#comments` is a position within a document,
 * not a different one, and treating it as a mismatch would refuse every
 * in-page anchor click.
 */
export function sameDocument(a: string, b: string): boolean {
  try {
    const left = new URL(a)
    const right = new URL(b)
    left.hash = ''
    right.hash = ''
    return left.href === right.href
  } catch {
    return a === b
  }
}

export type Analysis = { result: DateResult; fromCache: boolean } | { error: 'unreadable' }

export type AnalyzeOptions = {
  /** Ask the Internet Archive about edits the page does not admit to. */
  withArchive?: boolean
  /**
   * Refuse the read unless the tab is still showing this URL. Set by the
   * background worker, which reads on navigation and can therefore race the
   * page it is asking about; the popup reads on a click and cannot.
   */
  expectUrl?: string
  /**
   * `false` shows the result without writing it to the cache. Set for a private
   * window, which must leave nothing on disk, and for a read triggered by a URL
   * change with no page load behind it — see {@link isSoftNavigated}. A cached
   * entry is a claim that lasts a week; both are cases where that claim should
   * not be made.
   */
  persist?: boolean
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

  const read = await readPage(tabId, options.expectUrl)
  if (read === null) return { error: 'unreadable' }
  const { candidates } = read

  const archive = options.withArchive ? await fetchArchive(url) : null

  // Runs wherever `analyze` was called from, popup or service worker alike.
  // `resolve` is pure ranking over the candidates above — no DOM, no network —
  // so there is nothing here a service worker cannot do, and no reason for it
  // to borrow a DOM from anywhere.
  const result = await resolve(candidates, url, {}, archive?.lastEdit ? { archiveLastEdit: archive.lastEdit } : {})

  if (options.persist !== false && !read.soft) await writeCache(url, result)
  return { result, fromCache: false }
}
