/**
 * User settings, and the permission grants two of them depend on.
 *
 * Stored in `storage.local` rather than `storage.sync` on purpose: `autoRead`
 * and `archive` are meaningless without a host-permission grant, and grants do
 * not sync. A synced `autoRead: true` arriving on a device that never granted
 * anything would show a toggle that is on and does nothing.
 */

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

const area = (): StorageArea | null =>
  (globalThis as { browser?: { storage?: { local?: StorageArea } } }).browser?.storage?.local ??
  null

export async function getSettings(): Promise<Settings> {
  try {
    const stored = await area()?.get(KEY)
    return { ...DEFAULTS, ...((stored?.[KEY] as Partial<Settings> | undefined) ?? {}) }
  } catch {
    // A settings read must never be the reason the popup fails to render.
    return { ...DEFAULTS }
  }
}

export async function saveSettings(next: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await getSettings()), ...next }
  await area()?.set({ [KEY]: merged })
  return merged
}

type PermissionsApi = {
  request: (p: { origins: string[] }) => Promise<boolean>
  remove: (p: { origins: string[] }) => Promise<boolean>
  contains?: (p: { origins: string[] }) => Promise<boolean>
}

const permissionsApi = (): PermissionsApi | undefined =>
  (globalThis as { browser?: { permissions?: PermissionsApi } }).browser?.permissions

/**
 * Turn a setting on only if its permission is granted, and hand the permission
 * back when it is turned off.
 *
 * Keeping the grant tied to the toggle is the whole reason this extension can
 * ask for nothing at install time: `<all_urls>` is requested at the moment
 * someone opts in, and revoked the moment they opt out, rather than sitting in
 * the manifest forever because a feature might one day be enabled.
 */
export async function setAutoRead(enabled: boolean): Promise<boolean> {
  const permissions = permissionsApi()

  if (!enabled) {
    await releaseAllOrigins({ autoRead: false })
    await saveSettings({ autoRead: false })
    return false
  }

  const granted = (await permissions?.request({ origins: AUTO_READ_ORIGINS })) ?? false
  await saveSettings({ autoRead: granted })
  return granted
}

/**
 * Turn search-result annotation on at a tier, requesting exactly what that tier
 * needs.
 *
 * `url` needs access to the engines, to run at all. `fetch` needs access to
 * everywhere, because a result can be any site — a much larger ask, so it is
 * made separately and only when someone picks that tier. Stepping back down from
 * `fetch` to `url` hands the wider grant back rather than keeping it because it
 * might be wanted again.
 *
 * Returns the tier actually reached, which is `off` if the prompt was declined.
 * The caller must use the return value rather than the value it asked for: a
 * declined prompt that still flipped the toggle is a control that lies.
 */
export async function setSearchAnnotate(tier: SearchAnnotate): Promise<SearchAnnotate> {
  const permissions = permissionsApi()

  if (tier === 'off') {
    await releaseAllOrigins({ searchAnnotate: 'off' })
    await permissions?.remove({ origins: SEARCH_ORIGINS }).catch(() => false)
    await saveSettings({ searchAnnotate: 'off' })
    return 'off'
  }

  const onEngines = (await permissions?.request({ origins: SEARCH_ORIGINS })) ?? false
  if (!onEngines) {
    await saveSettings({ searchAnnotate: 'off' })
    return 'off'
  }

  if (tier === 'url') {
    await releaseAllOrigins({ searchAnnotate: 'url' })
    await saveSettings({ searchAnnotate: 'url' })
    return 'url'
  }

  const everywhere = (await permissions?.request({ origins: SEARCH_FETCH_ORIGINS })) ?? false
  // A declined second prompt lands on `url` rather than `off`: the first grant
  // was given and the cheaper tier works with it, so throwing that away too
  // would punish someone for declining the larger ask.
  const reached: SearchAnnotate = everywhere ? 'fetch' : 'url'
  await saveSettings({ searchAnnotate: reached })
  return reached
}

/**
 * Give back the all-sites grant, but only if nothing still needs it.
 *
 * `autoRead` and `searchAnnotate: 'fetch'` request the same grant, so a naive
 * `remove` on either one silently breaks the other — the toggle stays on, the
 * feature stops working, and nothing says why. `next` carries the change being
 * applied, because the stored settings have not been written yet at the point
 * this has to decide.
 */
async function releaseAllOrigins(next: Partial<Settings>): Promise<void> {
  const after = { ...(await getSettings()), ...next }
  if (after.autoRead || after.searchAnnotate === 'fetch') return
  await permissionsApi()?.remove({ origins: AUTO_READ_ORIGINS }).catch(() => false)
}

/** Whether the grants a tier needs are actually in place right now. */
export async function searchAnnotateGranted(tier: SearchAnnotate): Promise<boolean> {
  if (tier === 'off') return true
  const permissions = permissionsApi()
  if (!permissions?.contains) return false

  try {
    if (!(await permissions.contains({ origins: SEARCH_ORIGINS }))) return false
    if (tier === 'url') return true
    return await permissions.contains({ origins: SEARCH_FETCH_ORIGINS })
  } catch {
    return false
  }
}
