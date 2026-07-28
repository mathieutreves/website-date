import { cacheStats, clearCache } from '../../lib/analyze.js'
import { t } from '../../lib/messages.js'
import {
  ARCHIVE_ORIGINS,
  getSettings,
  saveSettings,
  setAutoRead,
  type ArchiveMode,
  type DateFormat,
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

void render()

async function render(): Promise<void> {
  const [settings, stats] = await Promise.all([getSettings(), cacheStats()])
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
  })

  const archiveStatus = document.getElementById('archive-status') as HTMLElement

  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="archive"]')) {
    input.addEventListener('change', async () => {
      const mode = input.value as ArchiveMode
      archiveStatus.hidden = true

      // "Never" needs no grant, so it also hands back any grant already given.
      if (mode === 'off') {
        await browser.permissions.remove({ origins: ARCHIVE_ORIGINS }).catch(() => false)
        await saveSettings({ archive: 'off' })
        return
      }

      // "Always" means no further prompting, so the grant has to be taken now.
      // "Ask each time" deliberately does not: it is requested from the popup
      // button, where the click is the user gesture the browser requires.
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
