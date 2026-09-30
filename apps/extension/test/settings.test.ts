import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULTS,
  getSettings,
  reconciled,
  reconcileGrants,
  saveSettings,
  SEARCH_ORIGINS,
  setAutoRead,
  setSearchAnnotate,
} from '../lib/settings.js'
import { fakeBrowser } from './fake-browser.js'

const EVERYWHERE = '*://*/*'

afterEach(() => vi.unstubAllGlobals())

describe('finding the extension API', () => {
  /*
   * Chrome before 148 has no `browser` global, only `chrome`. Reading the one
   * name found nothing there, and every function here degrades quietly — so
   * settings silently stayed at their defaults.
   */
  it('uses `chrome` when there is no `browser`', async () => {
    vi.stubGlobal('browser', undefined)
    vi.stubGlobal('chrome', fakeBrowser({ stored: { settings: { dateFormat: 'iso' } } }).api)

    expect((await getSettings()).dateFormat).toBe('iso')
  })

  it('falls back to the defaults when there is neither', async () => {
    vi.stubGlobal('browser', undefined)
    vi.stubGlobal('chrome', undefined)
    expect(await getSettings()).toEqual(DEFAULTS)
  })
})

describe('saving', () => {
  /*
   * Settings share a store with the result cache. Half the call sites are
   * `void saveSettings(…)` in a change handler, so a rejection is an unhandled
   * one and the control stays showing a choice that was never saved.
   */
  it('drops the cache and tries again when the store is full', async () => {
    const { api, stored } = fakeBrowser({ stored: { 'd:https://x.com/': { big: true } }, failSets: 1 })
    vi.stubGlobal('browser', api)

    const saved = await saveSettings({ dateFormat: 'iso' })

    expect(saved.dateFormat).toBe('iso')
    expect(stored).not.toHaveProperty('d:https://x.com/')
    expect(stored.settings).toMatchObject({ dateFormat: 'iso' })
  })

  it('never rejects, and reports what is really stored', async () => {
    vi.stubGlobal('browser', fakeBrowser({ failSets: 2 }).api)
    await expect(saveSettings({ dateFormat: 'iso' })).resolves.toMatchObject({ dateFormat: 'relative' })
  })
})

describe('automatic reading', () => {
  /*
   * Removing an overlay is an injection, and the grant is what permits it. The
   * grant used to go first, so the background's clean-up failed silently and
   * the overlays stayed on every open tab until it was reloaded.
   */
  it('clears the tabs while it still holds the grant to do so', async () => {
    const { api, log, granted } = fakeBrowser({
      stored: { settings: { autoRead: true } },
      granted: [EVERYWHERE],
    })
    vi.stubGlobal('browser', api)

    expect(await setAutoRead(false)).toBe(false)

    const revoke = log.indexOf(`revoke:${EVERYWHERE}`)
    expect(revoke).toBeGreaterThan(-1)
    expect(log.indexOf('inject:1')).toBeGreaterThan(log.indexOf('set:settings'))
    expect(log.indexOf('inject:1')).toBeLessThan(revoke)
    expect(log.indexOf('inject:2')).toBeLessThan(revoke)
    expect(granted.has(EVERYWHERE)).toBe(false)
  })

  it('keeps the grant when result pages still need it', async () => {
    const { api, granted } = fakeBrowser({
      stored: { settings: { autoRead: true, searchAnnotate: 'fetch' } },
      granted: [EVERYWHERE, ...SEARCH_ORIGINS],
    })
    vi.stubGlobal('browser', api)

    await setAutoRead(false)
    expect(granted.has(EVERYWHERE)).toBe(true)
  })

  it('asks before it awaits anything else', async () => {
    const { api, log } = fakeBrowser()
    vi.stubGlobal('browser', api)

    expect(await setAutoRead(true)).toBe(true)
    expect(log[0]).toBe(`request:${EVERYWHERE}`)
  })

  it('stays off when the request is rejected outright', async () => {
    const { api, stored } = fakeBrowser({ request: new Error('not from a user input handler') })
    vi.stubGlobal('browser', api)

    expect(await setAutoRead(true)).toBe(false)
    expect(stored.settings).toMatchObject({ autoRead: false })
  })
})

describe('search annotation', () => {
  /*
   * Two prompts, the second after an `await`, is a request Firefox rejects:
   * the click's user gesture is spent by then. One request, first.
   */
  it('asks for the fetch tier in a single request', async () => {
    const { api, log } = fakeBrowser()
    vi.stubGlobal('browser', api)

    expect(await setSearchAnnotate('fetch')).toBe('fetch')

    const requests = log.filter((line) => line.startsWith('request:'))
    expect(requests).toEqual([`request:${[...SEARCH_ORIGINS, EVERYWHERE].join(' ')}`])
    expect(log[0]).toBe(requests[0])
  })

  it('asks the url tier for the engines and nothing wider', async () => {
    const { api, log } = fakeBrowser()
    vi.stubGlobal('browser', api)

    expect(await setSearchAnnotate('url')).toBe('url')
    expect(log[0]).toBe(`request:${SEARCH_ORIGINS.join(' ')}`)
  })

  it('reverts to off when the request is rejected rather than declined', async () => {
    const { api, stored } = fakeBrowser({ request: new Error('not from a user input handler') })
    vi.stubGlobal('browser', api)

    expect(await setSearchAnnotate('fetch')).toBe('off')
    expect(stored.settings).toMatchObject({ searchAnnotate: 'off' })
  })

  it('keeps the cheap tier when stepping up from it is declined', async () => {
    const { api } = fakeBrowser({
      stored: { settings: { searchAnnotate: 'url' } },
      granted: [...SEARCH_ORIGINS],
      request: false,
    })
    vi.stubGlobal('browser', api)

    expect(await setSearchAnnotate('fetch')).toBe('url')
  })

  it('hands the wider grant back when stepping down to the url tier', async () => {
    const { api, granted } = fakeBrowser({
      stored: { settings: { searchAnnotate: 'fetch' } },
      granted: [EVERYWHERE, ...SEARCH_ORIGINS],
    })
    vi.stubGlobal('browser', api)

    expect(await setSearchAnnotate('url')).toBe('url')
    expect(granted.has(EVERYWHERE)).toBe(false)
    expect(granted.has(SEARCH_ORIGINS[0]!)).toBe(true)
  })

  it('hands everything back when switched off', async () => {
    const { api, granted } = fakeBrowser({
      stored: { settings: { searchAnnotate: 'fetch' } },
      granted: [EVERYWHERE, ...SEARCH_ORIGINS],
    })
    vi.stubGlobal('browser', api)

    expect(await setSearchAnnotate('off')).toBe('off')
    expect([...granted]).toEqual([])
  })
})

/*
 * A grant can be revoked from the browser's own permissions page. The features
 * stop, correctly — and the settings page went on showing them as on.
 */
describe('settings whose grant has gone', () => {
  const on = { ...DEFAULTS, autoRead: true, searchAnnotate: 'fetch', archive: 'always' } as const
  const all = { everywhere: true, engines: true, archive: true }

  it('changes nothing while every grant is held', () => {
    expect(reconciled(on, all)).toEqual({})
  })

  it('switches automatic reading off, and drops fetch to the url tier', () => {
    expect(reconciled(on, { ...all, everywhere: false })).toEqual({
      autoRead: false,
      searchAnnotate: 'url',
    })
  })

  it('switches annotation off entirely when the engines are gone', () => {
    expect(reconciled(on, { ...all, engines: false })).toEqual({ searchAnnotate: 'off' })
  })

  it('switches the automatic archive lookup off', () => {
    expect(reconciled(on, { ...all, archive: false })).toEqual({ archive: 'off' })
  })

  it('leaves "ask each time" alone, which holds no grant to lose', () => {
    expect(reconciled({ ...on, archive: 'ask' }, { ...all, archive: false })).toEqual({})
  })

  it('does not switch anything off because a check failed', () => {
    expect(reconciled(on, { everywhere: null, engines: null, archive: null })).toEqual({})
  })

  it('writes the correction to storage', async () => {
    const { api, stored } = fakeBrowser({
      stored: { settings: { autoRead: true, searchAnnotate: 'fetch' } },
      granted: [...SEARCH_ORIGINS],
    })
    vi.stubGlobal('browser', api)

    expect(await reconcileGrants()).toMatchObject({ autoRead: false, searchAnnotate: 'url' })
    expect(stored.settings).toMatchObject({ autoRead: false, searchAnnotate: 'url' })
  })

  it('writes nothing when there is nothing to correct', async () => {
    const { api, log } = fakeBrowser({ stored: { settings: { autoRead: true } }, granted: [EVERYWHERE] })
    vi.stubGlobal('browser', api)

    await reconcileGrants()
    expect(log).toEqual([])
  })
})
