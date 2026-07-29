import type { Candidate } from 'pagedate'
import { analyze } from '../lib/analyze.js'
import { badgeFor } from '../lib/badge.js'
import { checkLink, hostOf, toastFor } from '../lib/link-menu.js'
import { acceptLinkRead, LINK_REQUEST_GLOBAL, LINK_RESULT_GLOBAL } from '../lib/link-read.js'
import { SEARCH_MATCHES, SEARCH_ORIGINS } from '../lib/search-sites.js'
import { t } from '../lib/messages.js'
import { clearOverlay, overlayData, paintOverlay } from '../lib/overlay.js'
import { paintToast, toastData } from '../lib/toast.js'
import { AUTO_READ_ORIGINS, getSettings } from '../lib/settings.js'

/**
 * Optional background pass: read each page as you browse, put its age on the
 * toolbar icon, and — if asked — in the corner of the page itself.
 *
 * This is off by default and does nothing until two things are true: the
 * setting is on *and* the `<all_urls>` grant exists. Neither is requested at
 * install time; the toggle in the options page asks for the grant at the moment
 * it is switched on, and gives it back when it is switched off.
 *
 * The read is the same `analyze()` the popup uses, against the same cache, so
 * the badge, the overlay and the panel cannot report different things.
 */
export default defineBackground(() => {
  /**
   * Single-page apps change the URL without a page load, so a read fired on
   * navigation races the render. This is the settle delay before reading, and
   * `analyze` additionally refuses any read whose `location.href` no longer
   * matches — belt and braces, because a wrong read gets cached for a week.
   */
  const SPA_SETTLE_MS = 400
  const RETRY_MS = 700

  /**
   * Navigations can outrun their own analysis. Without a generation check, a
   * slow read of page A can land after a fast read of page B and overwrite it —
   * which looks exactly like the stale badge this is meant to fix.
   */
  const generation = new Map<number, number>()

  /**
   * Tabs we have actually drawn into. Injecting a removal script into every
   * page on every navigation, on the chance something is there, is exactly the
   * kind of gratuitous page access this extension is built to avoid.
   */
  const painted = new Set<number>()

  const granted = async (): Promise<boolean> => {
    try {
      return await browser.permissions.contains({ origins: AUTO_READ_ORIGINS })
    } catch {
      return false
    }
  }

  const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

  async function update(tabId: number, url: string | undefined, spa: boolean): Promise<void> {
    const mine = (generation.get(tabId) ?? 0) + 1
    generation.set(tabId, mine)
    const current = () => generation.get(tabId) === mine

    const settings = await getSettings()
    const on = settings.autoRead && (await granted())

    if (!url || !/^https?:/i.test(url) || !on) {
      await clear(tabId)
      return
    }

    // Whatever is on screen belongs to the previous page. Clearing first means
    // a slow read shows nothing rather than something wrong.
    await clear(tabId)
    if (spa) await wait(SPA_SETTLE_MS)
    if (!current()) return

    let analysis = await analyze(tabId, url, { expectUrl: url })

    // A refused read on an SPA usually means the new view had not rendered.
    // One more attempt, then give up rather than cache a guess.
    if ('error' in analysis && spa) {
      await wait(RETRY_MS)
      if (!current()) return
      analysis = await analyze(tabId, url, { expectUrl: url })
    }

    if (!current() || 'error' in analysis) return

    const badge = badgeFor(analysis.result, new Date())
    try {
      await browser.action.setBadgeText({ tabId, text: badge.text })
      await browser.action.setBadgeBackgroundColor({ tabId, color: badge.color })
      await browser.action.setTitle({ tabId, title: `${t('extName')} — ${badge.title}` })
    } catch {
      // A tab that closed mid-analysis. Nothing to report to.
    }

    const data = overlayData(
      analysis.result,
      new Date(),
      settings.overlay,
      settings.overlayPosition,
      settings.dateFormat,
    )
    if (!data || !current()) return

    try {
      await browser.scripting.executeScript({
        target: { tabId },
        func: paintOverlay,
        args: [data],
      })
      painted.add(tabId)
    } catch {
      // Pages that refuse injection (the extension gallery, PDF viewers).
    }
  }

  async function clear(tabId: number, force = false): Promise<void> {
    try {
      await browser.action.setBadgeText({ tabId, text: '' })
      await browser.action.setTitle({ tabId, title: t('extName') })
    } catch {
      // Tab is gone.
    }

    if (!force && !painted.has(tabId)) return
    painted.delete(tabId)
    try {
      await browser.scripting.executeScript({ target: { tabId }, func: clearOverlay })
    } catch {
      // No overlay to remove, or injection refused.
    }
  }

  /**
   * `status: 'complete'` covers real page loads. `changeInfo.url` covers
   * `history.pushState`, which is how Reddit, GitHub and most of the modern web
   * navigate — those never reach `complete`, so watching only for it left the
   * badge showing the previous page indefinitely.
   */
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) void update(tabId, changeInfo.url, changeInfo.status !== 'loading')
    else if (changeInfo.status === 'complete') void update(tabId, tab.url, false)
  })

  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.tabs.get(tabId).then((tab) => update(tabId, tab.url, false))
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    generation.delete(tabId)
  })

  // Turning a setting off has to take effect on tabs already showing a badge or
  // an overlay, not just on the next navigation.
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.settings) return
    void syncMenu()
    void syncAnnotator()
    void browser.tabs.query({}).then(async (tabs) => {
      for (const tab of tabs) {
        if (tab.id === undefined) continue
        // Forced, because the worker may have restarted since painting and
        // lost track of which tabs carry an overlay — leaving one stranded on
        // a page after the setting that created it was switched off.
        await clear(tab.id, true)
        await update(tab.id, tab.url, false)
      }
    })
  })

  // ------------------------------------------------------- right-click a link

  const MENU_ID = 'pagedate-check-link'

  /**
   * Run each registration task one at a time, in call order.
   *
   * Both syncs below are read-modify-write against browser-global state, and
   * both are triggered from four places — install, startup, a settings change,
   * and worker start. Two overlapping runs each await their teardown, then each
   * perform their setup, and the second `contextMenus.create` fails with
   * `Cannot create item with duplicate id`. `await` inside the function does not
   * help; the interleaving is between separate invocations, so the queue has to
   * be outside them.
   *
   * The chain always continues from a *settled* promise, so one failing sync
   * cannot wedge every later one behind a rejection — and what the caller gets
   * back never rejects either, because every call site here is a
   * fire-and-forget `void` and an unhandled rejection is all it could produce.
   * Both syncs already swallow their own errors; this is the backstop.
   */
  function serial(): (task: () => Promise<void>) => Promise<void> {
    let queue: Promise<void> = Promise.resolve()
    return (task) => {
      queue = queue.then(task).catch(() => {})
      return queue
    }
  }

  const menuQueue = serial()
  const annotatorQueue = serial()

  /**
   * Create or remove the menu entry to match the setting.
   *
   * `removeAll` then recreate, rather than tracking whether it exists: the
   * worker is evicted and restarted freely in MV3, so any flag it keeps about
   * what it has already registered is a guess. `create` on an existing id is an
   * error, and a stale entry left behind by a previous worker generation is the
   * normal case rather than the odd one.
   */
  const syncMenu = (): Promise<void> =>
    menuQueue(async () => {
      try {
        await browser.contextMenus.removeAll()
        const { linkMenu } = await getSettings()
        if (!linkMenu) return

        // The callback form, so `runtime.lastError` is read. `create` reports
        // failure only through it, and an unread lastError is logged by Chrome
        // as an unchecked error against the extension.
        browser.contextMenus.create({ id: MENU_ID, title: t('menuCheckLink'), contexts: ['link'] }, () => {
          void browser.runtime.lastError
        })
      } catch {
        // Firefox before the menus API settled, or a worker torn down mid-call.
      }
    })

  // ------------------------------------------------- annotate search results

  const ANNOTATOR_ID = 'pagedate-annotate'

  /**
   * Register or unregister the results-page content script to match the setting.
   *
   * Registered at runtime rather than declared in the manifest, and that is a
   * privacy decision rather than a build one: a declared content script puts its
   * `matches` into Chrome's install-time permission prompt, so the manifest
   * would demand access to five search engines from everyone who installs this,
   * including the majority who never turn the feature on. See the note at the
   * top of entrypoints/annotate.content.ts.
   *
   * Unregister-then-register rather than checking what exists, for the same
   * reason `syncMenu` does: the worker is evicted freely, so anything it
   * remembers about its own past registrations is a guess.
   */
  const syncAnnotator = (): Promise<void> =>
    annotatorQueue(async () => {
      try {
        await browser.scripting.unregisterContentScripts({ ids: [ANNOTATOR_ID] }).catch(() => {})

        const { searchAnnotate } = await getSettings()
        if (searchAnnotate === 'off') return

        // The grant can be revoked from the browser's own UI without this
        // extension hearing about it, and registering against origins we do not
        // hold throws.
        const granted = await browser.permissions
          .contains({ origins: SEARCH_ORIGINS })
          .catch(() => false)
        if (!granted) return

        await browser.scripting.registerContentScripts([
          {
            id: ANNOTATOR_ID,
            js: [ANNOTATE_SCRIPT],
            matches: SEARCH_MATCHES,
            runAt: 'document_idle',
          },
        ])
      } catch {
        // Nothing here is recoverable and none of it is worth breaking the rest
        // of the worker's startup for.
      }
    })

  browser.runtime.onInstalled.addListener(() => {
    void syncMenu()
    void syncAnnotator()
  })
  browser.runtime.onStartup.addListener(() => {
    void syncMenu()
    void syncAnnotator()
  })

  // A grant revoked from the browser's own permissions UI has to take the
  // registration down with it, or the script stays registered and inert.
  browser.permissions.onRemoved?.addListener(() => void syncAnnotator())
  browser.permissions.onAdded?.addListener(() => void syncAnnotator())

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !info.linkUrl || tab?.id === undefined) return
    void onLinkClicked(info.linkUrl, tab.id)
  })

  async function onLinkClicked(linkUrl: string, tabId: number): Promise<void> {
    const settings = await getSettings()

    const toast = async (data: Parameters<typeof paintToast>[0]): Promise<void> => {
      try {
        await browser.scripting.executeScript({ target: { tabId }, func: paintToast, args: [data] })
      } catch {
        // The page refuses injection. There is nowhere to put the answer, and a
        // notification would be a second permission for an edge case.
      }
    }

    const outcome = await checkLink(linkUrl, {
      hasOrigin: (pattern) =>
        browser.permissions.contains({ origins: [pattern] }).catch(() => false),
      requestOrigin: (pattern) =>
        browser.permissions.request({ origins: [pattern] }).catch(() => false),
      readInTab: (url) => readLinkInTab(tabId, url),
    })

    await toast(toastData(toastFor(outcome, hostOf(linkUrl), new Date(), settings.dateFormat)))
  }

  /** Built by WXT from `entrypoints/link-extract.ts`. Root-relative, per {@link EXTRACT_SCRIPT}. */
  const LINK_EXTRACT_SCRIPT = '/link-extract.js'

  /** Built by WXT from `entrypoints/annotate.content.ts`. */
  const ANNOTATE_SCRIPT = 'content-scripts/annotate.js'

  /**
   * Fetch and extract a linked page, in the tab.
   *
   * Three injections, for the reason given in `lib/link-read.ts`:
   * `executeScript({ files })` accepts no arguments, so the URL is written into
   * the isolated world first, the bundle reads it, and a third call reads the
   * answer back. All three land in the same isolated world, invisible to the
   * page.
   */
  async function readLinkInTab(tabId: number, url: string): Promise<Candidate[] | null> {
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        func: (key: string, value: string) => {
          ;(globalThis as unknown as Record<string, unknown>)[key] = value
        },
        args: [LINK_REQUEST_GLOBAL, url],
      })

      await browser.scripting.executeScript({ target: { tabId }, files: [LINK_EXTRACT_SCRIPT] })

      const [injection] = await browser.scripting.executeScript({
        target: { tabId },
        func: (key: string) => (globalThis as unknown as Record<string, unknown>)[key],
        args: [LINK_RESULT_GLOBAL],
      })

      return acceptLinkRead(injection?.result, url)
    } catch {
      return null
    }
  }

  /*
   * On every worker start, which is the case `onInstalled` and `onStartup` miss.
   * MV3 evicts the worker whenever it is idle and runs this body again on the
   * next event, and a menu entry or a script registration made by a previous
   * generation is not something this one can assume survived. Both are
   * idempotent and both go through the queue above, so running them here as
   * well as from the two lifecycle events costs a no-op rather than a duplicate.
   */
  void syncMenu()
  void syncAnnotator()
})
