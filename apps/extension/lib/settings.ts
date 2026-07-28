/**
 * User settings, and the permission grants two of them depend on.
 *
 * Stored in `storage.local` rather than `storage.sync` on purpose: `autoRead`
 * and `archive` are meaningless without a host-permission grant, and grants do
 * not sync. A synced `autoRead: true` arriving on a device that never granted
 * anything would show a toggle that is on and does nothing.
 */

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
}

const KEY = 'settings'

/** Host permission `autoRead` needs: reading a page requires access to it. */
export const AUTO_READ_ORIGINS = ['*://*/*']
export const ARCHIVE_ORIGINS = ['*://web.archive.org/*']

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
  const permissions = (
    globalThis as {
      browser?: {
        permissions?: {
          request: (p: { origins: string[] }) => Promise<boolean>
          remove: (p: { origins: string[] }) => Promise<boolean>
        }
      }
    }
  ).browser?.permissions

  if (!enabled) {
    await permissions?.remove({ origins: AUTO_READ_ORIGINS }).catch(() => false)
    await saveSettings({ autoRead: false })
    return false
  }

  const granted = (await permissions?.request({ origins: AUTO_READ_ORIGINS })) ?? false
  await saveSettings({ autoRead: granted })
  return granted
}
