import { analyze, dropCache } from '../../lib/analyze.js'
import { ARCHIVE_ORIGINS, getSettings } from '../../lib/settings.js'
import { t, uiLanguage } from '../../lib/messages.js'
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

/*
 * index.html is a static file, so its `lang` and its first line of text are
 * necessarily English. Both are corrected here before anything else runs.
 *
 * The English stays in the file rather than being blanked: module scripts are
 * deferred, so the markup paints first, and an empty panel for that frame is a
 * worse trade than one word in the wrong language.
 */
document.documentElement.lang = uiLanguage()
const placeholder = document.getElementById('loading')
if (placeholder) placeholder.textContent = t('loading')

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

    // A private window leaves nothing on disk: the result is shown and not kept.
    const analysis = await analyze(tab.id, url, {
      withArchive: archiveNow,
      persist: !tab.incognito,
    })

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
  if (tab?.url) await dropCache(tab.url)
  app.innerHTML = `<div class="state">${t('loading')}</div>`
  await main()
}

/**
 * The click is the consent, and the gesture the permission prompt needs — so
 * the request is the first thing awaited here, before any settings read.
 *
 * "Ask each time" has to mean each time. The grant used to be kept after the
 * first lookup, which made the second click a silent request to the archive
 * under a label that promised a question. It is handed back as soon as the
 * lookup is done, unless the reader has since chosen "Always", which owns it.
 */
async function checkArchive(): Promise<void> {
  const granted = await browser.permissions
    .request({ origins: ARCHIVE_ORIGINS })
    .catch(() => false)
  if (!granted) return

  try {
    app.innerHTML = `<div class="state">${t('archiveChecking')}</div>`
    await main(true)
  } finally {
    if ((await getSettings()).archive !== 'always') {
      await browser.permissions.remove({ origins: ARCHIVE_ORIGINS }).catch(() => false)
    }
  }
}
