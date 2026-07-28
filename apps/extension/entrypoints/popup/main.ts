import { analyze, cacheKey } from '../../lib/analyze.js'
import { ARCHIVE_ORIGINS, getSettings } from '../../lib/settings.js'
import { t } from '../../lib/messages.js'
import { errorView, unsupportedView, view } from './render.js'

/**
 * Browser glue. All view logic lives in render.ts, which has no browser
 * dependency and is tested directly.
 *
 * Everything runs in the popup rather than a content script: the page is read
 * once, on your click, by pulling `documentElement.outerHTML` through
 * `activeTab`. That reflects the hydrated DOM, so single-page apps work without
 * a MutationObserver, and no script has to be injected into every page load.
 *
 * (Turning on "check every page automatically" moves that same read into the
 * background worker, behind a permission grant. See entrypoints/background.ts.)
 */

const app = document.getElementById('app') as HTMLElement

void main()

async function main(withArchive = false): Promise<void> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    const url = tab?.url

    if (!tab?.id || !url || !/^https?:/i.test(url)) {
      render(unsupportedView())
      return
    }

    const settings = await getSettings()

    // "Always" only holds if the grant is still there — it can be revoked from
    // the browser's own permission UI without this extension being told.
    const archiveNow =
      withArchive ||
      (settings.archive === 'always' &&
        (await browser.permissions.contains({ origins: ARCHIVE_ORIGINS }).catch(() => false)))

    const analysis = await analyze(tab.id, url, { withArchive: archiveNow })

    if ('error' in analysis) {
      render(errorView(t('errorUnreadable')))
      return
    }

    render(
      view(analysis.result, url, {
        fromCache: analysis.fromCache,
        dateFormat: settings.dateFormat,
        archive: settings.archive,
        archiveChecked: archiveNow,
      }),
    )
  } catch (cause) {
    render(errorView(cause instanceof Error ? cause.message : String(cause)))
  }
}

function render(html: string): void {
  app.innerHTML = html
  document.getElementById('refresh')?.addEventListener('click', () => void refresh())
  document
    .getElementById('open-settings')
    ?.addEventListener('click', () => void browser.runtime.openOptionsPage())
  document.getElementById('check-archive')?.addEventListener('click', () => void checkArchive())
}

async function refresh(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.url) await browser.storage.local.remove(cacheKey(tab.url))
  app.innerHTML = `<div class="state">${t('loading')}</div>`
  await main()
}

/** The click is the consent, and the gesture the permission prompt needs. */
async function checkArchive(): Promise<void> {
  const granted = await browser.permissions
    .request({ origins: ARCHIVE_ORIGINS })
    .catch(() => false)
  if (!granted) return

  app.innerHTML = `<div class="state">${t('archiveChecking')}</div>`
  await main(true)
}
