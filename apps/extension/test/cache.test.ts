import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DateResult } from 'pagedate'
import {
  CACHE_MAX_ENTRIES,
  CACHE_TTL_MS,
  CACHE_VERSION,
  cacheKey,
  evictions,
  pruneCache,
  readCache,
  writeCache,
  type CacheEntry,
} from '../lib/cache.js'
import { fakeBrowser } from './fake-browser.js'

const NOW = Date.parse('2026-07-28T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

const result: DateResult = { candidates: [] }

const entry = (ageDays: number, over: Partial<CacheEntry> = {}): CacheEntry => ({
  result,
  fetchedAt: NOW - ageDays * DAY,
  version: CACHE_VERSION,
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('the cache key', () => {
  /*
   * `#comments` is a position in a document, not another document. Keying on
   * it stored one page once per anchor, and recorded which part was read.
   */
  it('drops the fragment', () => {
    expect(cacheKey('https://x.com/a#comments')).toBe(cacheKey('https://x.com/a'))
    expect(cacheKey('https://x.com/a#comments')).not.toContain('#')
  })

  it('keeps the query, which does name a different page', () => {
    expect(cacheKey('https://x.com/a?p=1')).not.toBe(cacheKey('https://x.com/a?p=2'))
  })

  it('still produces a key for something that is not a URL', () => {
    expect(cacheKey('junk')).toBe('d:junk')
  })
})

describe('what gets evicted', () => {
  it('removes entries past seven days, and keeps the rest', () => {
    const all = { 'd:old': entry(8), 'd:fresh': entry(1) }
    expect(evictions(all, NOW)).toEqual(['d:old'])
  })

  it('removes entries written by an earlier version', () => {
    // Including every entry keyed the old way, fragment and all.
    const all = { 'd:stale': entry(0, { version: CACHE_VERSION - 1 }), 'd:ok': entry(0) }
    expect(evictions(all, NOW)).toEqual(['d:stale'])
  })

  it('removes anything under the prefix that is not an entry at all', () => {
    expect(evictions({ 'd:garbage': 'not an entry' }, NOW)).toEqual(['d:garbage'])
  })

  it('never touches the settings', () => {
    const all = { settings: { autoRead: true }, 'd:old': entry(30) }
    expect(evictions(all, NOW)).toEqual(['d:old'])
  })

  it('caps the count, evicting the oldest', () => {
    const all = { 'd:a': entry(3), 'd:b': entry(1), 'd:c': entry(2) }
    expect(evictions(all, NOW, { maxEntries: 2, maxBytes: Infinity })).toEqual(['d:a'])
  })

  it('caps the bytes, evicting the oldest', () => {
    const all = { 'd:a': entry(3), 'd:b': entry(1), 'd:c': entry(2) }
    const one = 'd:a'.length + JSON.stringify(entry(1)).length
    expect(evictions(all, NOW, { maxEntries: 99, maxBytes: one * 2 })).toEqual(['d:a'])
  })

  it('has a ceiling at all', () => {
    const all = Object.fromEntries(
      Array.from({ length: CACHE_MAX_ENTRIES + 25 }, (_, i) => [`d:${i}`, entry(i / 1000)]),
    )
    expect(evictions(all, NOW)).toHaveLength(25)
  })
})

describe('against storage', () => {
  /*
   * The privacy policy says seven days. That used to be enforced by ignoring
   * an old entry when it was read, which left it on disk for good.
   */
  it('deletes expired entries rather than merely ignoring them', async () => {
    const { api, stored } = fakeBrowser({
      stored: { 'd:https://x.com/old': entry(8), 'd:https://x.com/new': entry(1), settings: {} },
    })
    vi.stubGlobal('browser', api)

    await pruneCache(NOW)

    expect(Object.keys(stored).sort()).toEqual(['d:https://x.com/new', 'settings'])
  })

  it('does not serve an entry past its seven days', async () => {
    vi.stubGlobal(
      'browser',
      fakeBrowser({
        stored: { [cacheKey('https://x.com/a')]: { ...entry(0), fetchedAt: Date.now() - CACHE_TTL_MS - 1 } },
      }).api,
    )
    expect(await readCache('https://x.com/a')).toBeNull()
  })

  it('reads back what it wrote, whichever anchor was showing', async () => {
    vi.stubGlobal('browser', fakeBrowser().api)

    await writeCache('https://x.com/a#top', result)
    expect(await readCache('https://x.com/a#comments')).toEqual(result)
  })

  it('survives a full store without throwing', async () => {
    vi.stubGlobal('browser', fakeBrowser({ failSets: 1 }).api)
    await expect(writeCache('https://x.com/a', result)).resolves.toBeUndefined()
  })
})
