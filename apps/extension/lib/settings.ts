/**
 * User settings, and the permission grants two of them depend on.
 *
 * Stored in `storage.local` rather than `storage.sync` on purpose: `autoRead`
 * and `archive` are meaningless without a host-permission grant, and grants do
 * not sync. A synced `autoRead: true` arriving on a device that never granted
 * anything would show a toggle that is on and does nothing.
 */

import { clearCache } from './cache.js'
import { clearOverlay } from './overlay.js'
import { SEARCH_ORIGINS } from './search-sites.js'

export { SEARCH_ORIGINS }

export type ArchiveMode = 'off' | 'ask' | 'always'
/**
 * `relative` and `absolute` choose which fact leads; `iso` also changes how the
 * date is written, to the sortable, unambiguous form. Asked for by people
 * pasting dates into spreadsheets and citations, where "12 March 2024" is a
 * step backwards and 03/12/2024 is a coin flip.
 */
export type DateFormat = 'relative' | 'absolute' | 'iso'
export type OverlayMode = 'never' | 'always' | 'conflict'
export type OverlayPosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

/**
 * How far to go annotating search results.
 *
 * Three values rather than a boolean because the two tiers are not degrees of
 * the same thing — they are different privacy propositions, and collapsing them
 * would hide that. `url` reads the address of each result and contacts nobody.
 * `fetch` requests the pages themselves, which means this extension making
 * requests to sites the reader has not visited, on the strength of them
 * appearing in a list. See lib/link-date.ts.
 */
export type SearchAnnotate = 'off' | 'url' | 'fetch'

export type Settings = {
  /** Read every page as you browse and show its age on the toolbar icon. */
  autoRead: boolean
  /** Ask web.archive.org about edits the page itself does not admit to. */
  archive: ArchiveMode
  /** Whether the headline leads with the age or the calendar date. */
  dateFormat: DateFormat
  /** Show the age in the corner of the page itself. */
  overlay: OverlayMode
  overlayPosition: OverlayPosition
  /** Offer "check when this was written" on right-clicking a link. */
  linkMenu: boolean
  /** Put ages next to search results. */
  searchAnnotate: SearchAnnotate
}

/**
 * Defaults are the privacy-preserving answer in every case. Anything that
 * widens access starts off and is turned on deliberately, by someone reading
 * the sentence next to it.
 *
 * `overlay` defaults to `never` even though it needs no permission beyond the
 * one `autoRead` already took: enabling automatic checking is a decision about
 * *reading* pages, and does not imply consent to draw on them. Two decisions,
 * two controls.
 */
export const DEFAULTS: Settings = {
  autoRead: false,
  archive: 'off',
  dateFormat: 'relative',
  overlay: 'never',
  overlayPosition: 'bottom-left',
  // The one new default that is on. It adds an entry to a menu and does nothing
  // else until it is clicked, needs no host access to exist, and the click is
  // itself the consent — which is not true of anything else here.
  linkMenu: true,
  searchAnnotate: 'off',
}

const KEY = 'settings'

/** Host permission `autoRead` needs: reading a page requires access to it. */
export const AUTO_READ_ORIGINS = ['*://*/*']
export const ARCHIVE_ORIGINS = ['*://web.archive.org/*']
/**
 * Reading result pages needs access to the engines; reading the *results* needs
 * access to everywhere, because a result can be any site. Two grants, requested
 * separately, because the second is a much larger ask than the first and
 * bundling them would hide that.
 */
export const SEARCH_FETCH_ORIGINS = ['*://*/*']

type StorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

type PermissionsApi = {
  request: (p: { origins: string[] }) => Promise<boolean>
  remove: (p: { origins: string[] }) => Promise<boolean>
  contains?: (p: { origins: string[] }) => Promise<boolean>
}

type TabsApi = { query: (q: object) => Promise<{ id?: number }[]> }
type ActionApi = {
  setBadgeText?: (d: { tabId: number; text: string }) => Promise<void>
}
type ScriptingApi = {
  executeScript: (i: { target: { tabId: number }; func: () => void }) => Promise<unknown>
}

type Host = {
  storage?: { local?: StorageArea }
  permissions?: PermissionsApi
  tabs?: TabsApi
  action?: ActionApi
  scripting?: ScriptingApi
}

/**
 * The extension API, under whichever name this browser gives it.
 *
 * `browser` first and `chrome` second, the same resolution as lib/messages.ts.
 * Reading `globalThis.browser` alone — which this file used to do — finds
 * nothing in Chrome before 148, where only `chrome` exists, and every function
 * here is written to degrade quietly when the API is missing: settings fell
 * back to their defaults, saves went nowhere, and nothing reported it.
 */
const host = (): Host | undefined =>
  (globalThis as { browser?: Host; chrome?: Host }).browser ??
  (globalThis as { chrome?: Host }).chrome

const area = (): StorageArea | null => host()?.storage?.local ?? null

export async function getSettings(): Promise<Settings> {
  try {
    const stored = await area()?.get(KEY)
    return { ...DEFAULTS, ...((stored?.[KEY] as Partial<Settings> | undefined) ?? {}) }
  } catch {
    // A settings read must never be the reason the popup fails to render.
    return { ...DEFAULTS }
  }
}

/**
 * Merge and store. Never rejects, and returns what is actually stored.
 *
 * Settings share `storage.local` with the result cache, so a full store fails
 * this write too. Half the call sites are fire-and-forget `void`s from a change
 * handler, where a rejection is an unhandled one and the control stays showing
 * a choice that was never saved. The cache is the expendable half of that
 * store — every entry in it can be recomputed — so it is dropped and the write
 * tried once more; if that fails as well, what comes back is what is on disk,
 * so a caller that renders from the return value shows the truth.
 */
export async function saveSettings(next: Partial<Settings>): Promise<Settings> {
  const before = await getSettings()
  const merged = { ...before, ...next }
  try {
    await area()?.set({ [KEY]: merged })
    return merged
  } catch {
    try {
      await clearCache()
      await area()?.set({ [KEY]: merged })
      return merged
    } catch {
      return before
    }
  }
}

const permissionsApi = (): PermissionsApi | undefined => host()?.permissions

const holds = async (origins: string[]): Promise<boolean | null> => {
  try {
    return (await permissionsApi()?.contains?.({ origins })) ?? null
  } catch {
    return null
  }
}

/**
 * Take the badge and the overlay off every open tab.
 *
 * Exists for the one moment it cannot be left to the background worker: just
 * before the all-sites grant is handed back. The worker clears tabs when it
 * sees the setting change, but it sees that through `storage.onChanged`, which
 * arrives after the grant has gone — and removing an overlay is an injection,
 * which the grant was the permission for. The overlays stayed on screen,
 * showing an age for a feature that was now off, until each tab was reloaded.
 */
async function clearTabs(): Promise<void> {
  const api = host()
  try {
    const tabs = (await api?.tabs?.query({})) ?? []
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined) return
        const tabId = tab.id
        await api?.action?.setBadgeText?.({ tabId, text: '' })?.catch(() => {})
        await api?.scripting?.executeScript({ target: { tabId }, func: clearOverlay }).catch(() => {})
      }),
    )
  } catch {
    // No tabs API here, or nothing to clear.
  }
}

/**
 * Turn a setting on only if its permission is granted, and hand the permission
 * back when it is turned off.
 *
 * Keeping the grant tied to the toggle is the whole reason this extension can
 * ask for nothing at install time: `<all_urls>` is requested at the moment
 * someone opts in, and revoked the moment they opt out, rather than sitting in
 * the manifest forever because a feature might one day be enabled.
 *
 * Two orderings here are load-bearing. Turning on, `request` is the first
 * thing awaited: a permission prompt needs the click's user gesture, and
 * Firefox considers the gesture spent after any earlier `await`. Turning off,
 * the grant goes last: the setting is saved so nothing new is drawn, the tabs
 * are cleared while clearing them is still permitted, and only then is the
 * permission released.
 */
export async function setAutoRead(enabled: boolean): Promise<boolean> {
  const permissions = permissionsApi()

  if (!enabled) {
    await saveSettings({ autoRead: false })
    await clearTabs()
    await releaseAllOrigins()
    return false
  }

  const granted =
    (await permissions?.request({ origins: AUTO_READ_ORIGINS }).catch(() => false)) ?? false
  return (await saveSettings({ autoRead: granted })).autoRead
}

/**
 * Turn search-result annotation on at a tier, requesting exactly what that tier
 * needs.
 *
 * `url` needs access to the engines, to run at all. `fetch` needs access to
 * everywhere, because a result can be any site — a much larger ask, made only
 * when someone picks that tier. Stepping back down from `fetch` to `url` hands
 * the wider grant back rather than keeping it because it might be wanted again.
 *
 * One `request` per call, and nothing awaited before it. The `fetch` tier used
 * to ask twice — the engines, then everywhere — and the second prompt came
 * after an `await`, by which point Firefox no longer counts the click as a
 * user gesture and rejects the request outright. So the tier asks for both
 * sets at once. The browser's prompt still lists what is being granted, which
 * is what the separate prompts were for.
 *
 * Returns the tier actually reached. The caller must use the return value
 * rather than the value it asked for: a declined prompt that still flipped the
 * toggle is a control that lies.
 */
export async function setSearchAnnotate(tier: SearchAnnotate): Promise<SearchAnnotate> {
  const permissions = permissionsApi()

  if (tier === 'off') {
    // Setting first, grants second, so that nothing observing the grants go —
    // see `reconcileGrants` — finds a setting that still claims them.
    await saveSettings({ searchAnnotate: 'off' })
    await releaseAllOrigins()
    await permissions?.remove({ origins: SEARCH_ORIGINS }).catch(() => false)
    return 'off'
  }

  const wanted = tier === 'fetch' ? [...SEARCH_ORIGINS, ...SEARCH_FETCH_ORIGINS] : SEARCH_ORIGINS
  const granted = (await permissions?.request({ origins: wanted }).catch(() => false)) ?? false

  // A declined `fetch` lands on `url` when the engines were already granted —
  // someone stepping up from the cheap tier and thinking better of it keeps
  // the tier they had, rather than being punished for declining the larger
  // ask. Asked from `off`, a refusal grants nothing and stays `off`.
  const reached: SearchAnnotate = granted
    ? tier
    : tier === 'fetch' && (await holds(SEARCH_ORIGINS)) === true
      ? 'url'
      : 'off'

  const stored = (await saveSettings({ searchAnnotate: reached })).searchAnnotate
  if (stored !== 'fetch') await releaseAllOrigins()
  if (stored === 'off') await permissions?.remove({ origins: SEARCH_ORIGINS }).catch(() => false)
  return stored
}

/**
 * Give back the all-sites grant, but only if nothing still needs it.
 *
 * `autoRead` and `searchAnnotate: 'fetch'` request the same grant, so a naive
 * `remove` on either one silently breaks the other — the toggle stays on, the
 * feature stops working, and nothing says why. Reads the stored settings, so
 * the change being applied has to be saved before this is called.
 */
async function releaseAllOrigins(): Promise<void> {
  const settings = await getSettings()
  if (settings.autoRead || settings.searchAnnotate === 'fetch') return
  await permissionsApi()?.remove({ origins: AUTO_READ_ORIGINS }).catch(() => false)
}

/** Whether the grants a tier needs are actually in place right now. */
export async function searchAnnotateGranted(tier: SearchAnnotate): Promise<boolean> {
  if (tier === 'off') return true
  if ((await holds(SEARCH_ORIGINS)) !== true) return false
  if (tier === 'url') return true
  return (await holds(SEARCH_FETCH_ORIGINS)) === true
}

/**
 * What the settings should be, given which grants are actually held.
 *
 * Pure. Every setting that depends on a grant falls back to the most it can
 * still do without it: `fetch` to `url` if the engines are still readable, and
 * everything else to off. `null` for a grant means it could not be checked,
 * which is not the same as missing — a permissions API that threw is no reason
 * to switch someone's features off.
 */
export function reconciled(
  settings: Settings,
  grants: { everywhere: boolean | null; engines: boolean | null; archive: boolean | null },
): Partial<Settings> {
  const next: Partial<Settings> = {}

  if (settings.autoRead && grants.everywhere === false) next.autoRead = false

  if (settings.searchAnnotate !== 'off' && grants.engines === false) next.searchAnnotate = 'off'
  else if (settings.searchAnnotate === 'fetch' && grants.everywhere === false) {
    next.searchAnnotate = 'url'
  }

  if (settings.archive === 'always' && grants.archive === false) next.archive = 'off'

  return next
}

/**
 * Bring the stored settings back into line with the grants, and return them.
 *
 * A grant can be revoked from the browser's own permissions page without this
 * extension being asked. The features fail safe when that happens — every one
 * checks its grant before acting — but the settings page rendered from storage
 * alone, so it went on showing a toggle as on for a feature that had stopped.
 * Called when a grant is removed and whenever the settings page draws.
 */
export async function reconcileGrants(): Promise<Settings> {
  const settings = await getSettings()
  const [everywhere, engines, archive] = await Promise.all([
    holds(AUTO_READ_ORIGINS),
    holds(SEARCH_ORIGINS),
    holds(ARCHIVE_ORIGINS),
  ])

  const changes = reconciled(settings, { everywhere, engines, archive })
  if (Object.keys(changes).length === 0) return settings

  const stored = await saveSettings(changes)
  // Revoking the engines while `fetch` was on leaves the all-sites grant held
  // with nothing using it.
  await releaseAllOrigins()
  return stored
}
