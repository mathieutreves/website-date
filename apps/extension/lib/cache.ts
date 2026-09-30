import type { DateResult } from 'pagedate'

/**
 * The result cache: one `storage.local` entry per analysed page.
 *
 * Its own module, importing only a *type* from the library, so that the things
 * which need to talk about the cache without analysing anything — the settings
 * code that frees space when a save hits the quota, the options page that
 * reports its size — do not pull the resolver in behind them.
 *
 * The privacy policy makes three promises about this cache, and each is a
 * function here rather than a sentence there: entries are deleted after seven
 * days ({@link pruneCache}), there is a ceiling on how many are kept
 * ({@link CACHE_MAX_ENTRIES}), and a private window leaves nothing behind (the
 * caller's `persist` flag, see lib/analyze.ts).
 */

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Bump to invalidate every cached result. Entries below this version are
 * discarded on read, and deleted by the next prune.
 *
 * Bump for a heuristics change, and equally for a change to the *shape* of what
 * is stored. The shape is the case that gets forgotten: an entry written before
 * `Conflict` carried the fields the UI builds its warning sentence from is a
 * complete, valid-looking `DateResult`, so nothing rejects it, and the warning
 * renders as "carries undefined dated elements from before then, back to ." —
 * a week of that, per reader, from one skipped increment.
 *
 * 4: the key lost its fragment. Entries under the old key shape would never be
 * read again, and would otherwise sit there until they aged out.
 */
export const CACHE_VERSION = 4

/**
 * How many pages are remembered at most, oldest evicted first.
 *
 * A TTL alone bounds the cache in time but not in size: with automatic reading
 * on, a week of browsing is thousands of pages, and the list of them is a
 * browsing history nobody asked this extension to keep. A few hundred is enough
 * that re-opening something from earlier today is instant, which is all the
 * cache is for.
 */
export const CACHE_MAX_ENTRIES = 300

/**
 * A ceiling in bytes as well, because entries are not the same size. A result
 * carries every candidate the page yielded, and one archive index on the
 * benchmark corpus yields 789 of them — a few hundred of those would walk
 * through Chrome's 10 MB `storage.local` quota and take the settings write
 * down with it.
 */
export const CACHE_MAX_BYTES = 4 * 1024 * 1024

/** Opportunistic pruning runs at most this often per context. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000

const PREFIX = 'd:'

export type CacheEntry = { result: DateResult; fetchedAt: number; version: number }

/**
 * The storage key for a page.
 *
 * Without the fragment: `#comments` is a position within a document, not a
 * different one — the same rule `sameDocument` applies to reads — and keying on
 * it stored one page several times over while recording which part of it was
 * being read.
 */
export const cacheKey = (url: string): string => {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return `${PREFIX}${parsed.href}`
  } catch {
    return `${PREFIX}${url}`
  }
}

const isEntry = (value: unknown): value is CacheEntry =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as CacheEntry).fetchedAt === 'number' &&
  typeof (value as CacheEntry).version === 'number'

const live = (entry: CacheEntry, now: number): boolean =>
  entry.version === CACHE_VERSION && now - entry.fetchedAt <= CACHE_TTL_MS

export type CacheLimits = { maxEntries: number; maxBytes: number }

/**
 * Which keys to delete from a snapshot of storage.
 *
 * Pure, so the policy is testable without a browser. In order: anything that is
 * not a current, unexpired entry goes; then the oldest go until the count fits;
 * then the oldest go until the bytes fit. Keys outside the cache's prefix —
 * the settings — are never candidates.
 */
export function evictions(
  all: Record<string, unknown>,
  now: number,
  limits: CacheLimits = { maxEntries: CACHE_MAX_ENTRIES, maxBytes: CACHE_MAX_BYTES },
): string[] {
  const doomed: string[] = []
  const kept: { key: string; fetchedAt: number; bytes: number }[] = []

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(PREFIX)) continue
    if (!isEntry(value) || !live(value, now)) {
      doomed.push(key)
      continue
    }
    kept.push({ key, fetchedAt: value.fetchedAt, bytes: key.length + JSON.stringify(value).length })
  }

  // Newest first, so everything past a limit is the oldest.
  kept.sort((a, b) => b.fetchedAt - a.fetchedAt)

  let bytes = 0
  kept.forEach((entry, index) => {
    bytes += entry.bytes
    if (index >= limits.maxEntries || bytes > limits.maxBytes) doomed.push(entry.key)
  })

  return doomed
}

export async function readCache(url: string): Promise<DateResult | null> {
  try {
    const key = cacheKey(url)
    const stored = await browser.storage.local.get(key)
    const entry = stored[key]
    if (!isEntry(entry) || !live(entry, Date.now())) return null
    return entry.result
  } catch {
    return null
  }
}

/**
 * Delete expired and surplus entries.
 *
 * Expiry used to be enforced only on read: an old entry was ignored, and stayed
 * on disk forever. "Kept for seven days" has to mean deleted, so this runs when
 * the background worker starts — which in MV3 is every time it wakes — and
 * after a write, throttled. An entry can therefore outlive its seven days by
 * however long the browser goes without the extension doing anything; it is
 * never *read* past them.
 */
export async function pruneCache(now: number = Date.now()): Promise<void> {
  try {
    lastPruned = now
    const keys = evictions(await browser.storage.local.get(null), now)
    if (keys.length > 0) await browser.storage.local.remove(keys)
  } catch {
    // Storage unavailable. Nothing was deleted, and the next run will try again.
  }
}

/** Per context: the popup is a new one each time it opens, the worker each wake. */
let lastPruned = 0

export async function writeCache(url: string, result: DateResult): Promise<void> {
  const entry: CacheEntry = { result, fetchedAt: Date.now(), version: CACHE_VERSION }
  try {
    await browser.storage.local.set({ [cacheKey(url)]: entry })
  } catch {
    // Storage full or unavailable — the result is still shown, just not cached.
    // Pruning makes room for the next one rather than retrying this one.
    await pruneCache()
    return
  }

  if (Date.now() - lastPruned > PRUNE_INTERVAL_MS) await pruneCache()
}

/** Forget one page, for the popup's re-check. */
export async function dropCache(url: string): Promise<void> {
  try {
    await browser.storage.local.remove(cacheKey(url))
  } catch {
    // Nothing to forget.
  }
}

/** How much of `storage.local` the result cache is using, for the options page. */
export async function cacheStats(): Promise<{ count: number; bytes: number }> {
  try {
    const all = await browser.storage.local.get(null)
    const entries = Object.entries(all).filter(([key]) => key.startsWith(PREFIX))
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
  const keys = Object.keys(all).filter((key) => key.startsWith(PREFIX))
  if (keys.length > 0) await browser.storage.local.remove(keys)
}
