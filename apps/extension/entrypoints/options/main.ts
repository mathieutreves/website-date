import { cacheStats, clearCache } from '../../lib/analyze.js'
import { t, uiLanguage } from '../../lib/messages.js'
import {
  ARCHIVE_ORIGINS,
  reconcileGrants,
  saveSettings,
  setAutoRead,
  setSearchAnnotate,
  type ArchiveMode,
  type DateFormat,
  type OverlayMode,
  type OverlayPosition,
  type SearchAnnotate,
} from '../../lib/settings.js'
import { optionsView } from './render.js'

/**
 * Browser glue for the settings page. All markup lives in render.ts.
 *
 * The rule every handler here follows: the browser decides whether a permission
 * is granted, so the control reflects what was actually granted rather than
 * what was clicked. A toggle that fails to get its grant switches itself back
 * off instead of showing a state that is not real.
 */

const app = document.getElementById('app') as HTMLElement

// Corrected from the static English in index.html. Unlike the popup this one
// has a visible tab title, which is the string a reader sees while the page is
// still loading.
document.documentElement.lang = uiLanguage()
document.title = t('optTitle')

void render()

/**
 * Drawn from the settings *as reconciled with the grants*, not from storage
 * alone. A grant revoked in the browser's own permissions page leaves the
 * stored setting saying "on", and a page that rendered it would be showing a
 * state that is not real — the thing the rule above exists to prevent.
 */
async function render(): Promise<void> {
  const [settings, stats] = await Promise.all([reconcileGrants(), cacheStats()])
  app.innerHTML = optionsView(settings, stats)
  wire()
}

function wire(): void {
  const autoRead = document.getElementById('auto-read') as HTMLInputElement
  const autoReadStatus = document.getElementById('auto-read-status') as HTMLElement

  autoRead.addEventListener('change', async () => {
    const wanted = autoRead.checked
    const granted = await setAutoRead(wanted)
    autoRead.checked = granted
    autoReadStatus.hidden = !(wanted && !granted)
    autoReadStatus.textContent = wanted && !granted ? t('optAutoReadDenied') : ''
    // The overlay section is gated on this, so the page has to redraw rather
    // than leave a disabled control next to a toggle that is now on.
    await render()
  })

  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="overlay"]')) {
    input.addEventListener('change', async () => {
      await saveSettings({ overlay: input.value as OverlayMode })
      // Choosing "never" removes the corner picker, choosing anything else
      // brings it back.
      await render()
    })
  }

  for (const input of document.querySelectorAll<HTMLInputElement>(
    'input[name="overlayPosition"]',
  )) {
    input.addEventListener('change', () => {
      void saveSettings({ overlayPosition: input.value as OverlayPosition })
    })
  }

  const archiveStatus = document.getElementById('archive-status') as HTMLElement

  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="archive"]')) {
    input.addEventListener('change', async () => {
      const mode = input.value as ArchiveMode
      archiveStatus.hidden = true

      // "Never" needs no grant, so it also hands back any grant already given.
      if (mode === 'off') {
        await saveSettings({ archive: 'off' })
        await browser.permissions.remove({ origins: ARCHIVE_ORIGINS }).catch(() => false)
        return
      }

      // "Always" means no further prompting, so the grant has to be taken now.
      // "Ask each time" deliberately does not: it is requested from the popup
      // button, where the click is the user gesture the browser requires — and
      // stepping down to it from "Always" gives back the grant that mode held,
      // or the next "ask" would not be one.
      // Saved before the grant goes, so nothing watching the grant disappear
      // finds a setting that still claims it.
      if (mode === 'ask') {
        await saveSettings({ archive: 'ask' })
        await browser.permissions.remove({ origins: ARCHIVE_ORIGINS }).catch(() => false)
        return
      }

      if (mode === 'always') {
        const granted = await browser.permissions
          .request({ origins: ARCHIVE_ORIGINS })
          .catch(() => false)
        if (!granted) {
          archiveStatus.hidden = false
          archiveStatus.textContent = t('optAutoReadDenied')
          const off = document.querySelector<HTMLInputElement>('input[name="archive"][value="off"]')
          if (off) off.checked = true
          await saveSettings({ archive: 'off' })
          return
        }
      }

      await saveSettings({ archive: mode })
    })
  }

  const searchStatus = document.getElementById('search-status') as HTMLElement

  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="searchAnnotate"]')) {
    input.addEventListener('change', async () => {
      const wanted = input.value as SearchAnnotate
      const reached = await setSearchAnnotate(wanted)

      // The radio reflects what the browser granted, not what was clicked. Two
      // distinct shortfalls, and they are different news: nothing was granted,
      // or the engines were but the whole web was not — in which case the
      // cheap tier is live and saying "declined" alone would be wrong.
      if (reached !== wanted) {
        const actual = document.querySelector<HTMLInputElement>(
          `input[name="searchAnnotate"][value="${reached}"]`,
        )
        if (actual) actual.checked = true
      }

      searchStatus.hidden = reached === wanted
      searchStatus.textContent =
        reached === wanted
          ? ''
          : reached === 'url'
            ? t('optSearchPartial')
            : t('optSearchDenied')
    })
  }

  const linkMenu = document.getElementById('link-menu') as HTMLInputElement
  linkMenu.addEventListener('change', () => {
    // No permission to negotiate: the entry exists or it does not, and the
    // background worker rebuilds the menu when the setting lands in storage.
    void saveSettings({ linkMenu: linkMenu.checked })
  })

  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="dateFormat"]')) {
    input.addEventListener('change', () => {
      void saveSettings({ dateFormat: input.value as DateFormat })
    })
  }

  document.getElementById('clear-cache')?.addEventListener('click', async () => {
    await clearCache()
    const line = document.getElementById('cache-line') as HTMLElement
    line.textContent = t('optCacheCleared')
    ;(document.getElementById('clear-cache') as HTMLButtonElement).disabled = true
  })
}
