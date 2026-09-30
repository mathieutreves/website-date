import type { Candidate } from 'pagedate'
import { analyze, pruneCache } from '../lib/analyze.js'
import { badgeFor } from '../lib/badge.js'
import {
  fetchBudget,
  isFetchRequest,
  refusal,
  type FetchReply,
  type FetchRequest,
  type RelaySender,
} from '../lib/fetch-relay.js'
import { fetchPageText } from '../lib/link-date.js'
import { checkingToast, checkLink, hostOf, toastFor } from '../lib/link-menu.js'
import {
  acceptLinkRead,
  LINK_REQUEST_GLOBAL,
  LINK_RESULT_GLOBAL,
  type LinkRequest,
} from '../lib/link-read.js'
import { registrationPlan } from '../lib/registration.js'
import { SEARCH_MATCHES, SEARCH_ORIGINS } from '../lib/search-sites.js'
import { t } from '../lib/messages.js'
import { clearOverlay, overlayData, paintOverlay } from '../lib/overlay.js'
import { CHECKING_TTL_MS, paintToast, toastData, type ToastData } from '../lib/toast.js'
import { AUTO_READ_ORIGINS, getSettings, reconcileGrants } from '../lib/settings.js'

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
   * matches.
   *
   * Neither is enough to *cache* such a read. The URL changes before the head
   * metadata does, so a read can match the new address and still describe the
   * previous route, and no delay is long enough to be sure it has caught up. A
   * read with no page load behind it is therefore shown and not stored — see
   * `persist` below, and `isSoftNavigated` in lib/analyze.ts for the same rule
   * applied from inside the page.
   */
  const SPA_SETTLE_MS = 400
  const RETRY_MS = 700

  /**
   * Navigations can outrun their own analysis. Without a generation check, a
   * slow read of page A can land after a fast read of page B and overwrite it —
   * which looks exactly like the stale badge this is meant to fix.
   */
  const generation = new Map<number, number>()

  const granted = async (): Promise<boolean> => {
    try {
      return await browser.permissions.contains({ origins: AUTO_READ_ORIGINS })
    } catch {
      return false
    }
  }

  const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

  type UpdateOptions = {
    /** The URL changed with no page load behind it. */
    spa?: boolean
    /** A private window: read and show, write nothing to disk. */
    incognito?: boolean
    /** Remove any overlay even if automatic reading is off — a setting just changed. */
    sweep?: boolean
  }

  async function update(tabId: number, url: string | undefined, options: UpdateOptions = {}): Promise<void> {
    const { spa = false, incognito = false, sweep = false } = options
    const mine = (generation.get(tabId) ?? 0) + 1
    generation.set(tabId, mine)
    const current = () => generation.get(tabId) === mine

    const settings = await getSettings()
    const on = settings.autoRead && (await granted())

    // Whatever is on screen belongs to the previous page. Clearing first means
    // a slow read shows nothing rather than something wrong.
    await clear(tabId, on || sweep)
    if (!url || !/^https?:/i.test(url) || !on) return

    if (spa) await wait(SPA_SETTLE_MS)
    if (!current()) return

    const read = { expectUrl: url, persist: !spa && !incognito }
    let analysis = await analyze(tabId, url, read)

    // A refused read on an SPA usually means the new view had not rendered.
    // One more attempt, then give up rather than show a guess.
    if ('error' in analysis && spa) {
      await wait(RETRY_MS)
      if (!current()) return
      analysis = await analyze(tabId, url, read)
    }

    if (!current() || 'error' in analysis) return

    const badge = badgeFor(analysis.result, new Date())
    await setBadge(tabId, badge.text, `${t('extName')} — ${badge.title}`, badge.color)

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
    } catch {
      // Pages that refuse injection (the extension gallery, PDF viewers).
    }
  }

  /**
   * Each call guarded on its own. Firefox for Android has an action but no
   * badge on it, and one missing method must not cost the tooltip as well.
   */
  async function setBadge(tabId: number, text: string, title: string, color?: string): Promise<void> {
    try {
      await browser.action.setBadgeText?.({ tabId, text })
      if (color) await browser.action.setBadgeBackgroundColor?.({ tabId, color })
      await browser.action.setTitle?.({ tabId, title })
    } catch {
      // A tab that closed mid-analysis. Nothing to report to.
    }
  }

  /**
   * Reset the badge and, if `overlay` is set, remove the on-page readout.
   *
   * The removal is an injection, and whether to make it used to be decided by
   * an in-memory set of tabs this worker had drawn into — on the principle that
   * injecting into every page on the chance something is there is gratuitous
   * page access. The principle stands; the set did not survive the worker
   * idling out, after which a single-page app's overlay from the previous route
   * was left on screen because nothing remembered drawing it.
   *
   * So the question asked is the one that needs no memory: is automatic reading
   * on, with its grant? If so this tab is about to be read anyway, and removing
   * a stale readout first is part of that read. If not, nothing is injected —
   * except when a setting has just changed, where it is the only way to take
   * down what the old setting put up.
   */
  async function clear(tabId: number, overlay: boolean): Promise<void> {
    await setBadge(tabId, '', t('extName'))

    if (!overlay) return
    try {
      await browser.scripting.executeScript({ target: { tabId }, func: clearOverlay })
    } catch {
      // No overlay to remove, or injection refused.
    }
  }

  /** Re-read every open tab, removing whatever a previous setting drew. */
  const sweep = async (): Promise<void> => {
    try {
      for (const tab of await browser.tabs.query({})) {
        if (tab.id === undefined) continue
        await update(tab.id, tab.url, { incognito: tab.incognito, sweep: true })
      }
    } catch {
      // No tabs to sweep.
    }
  }

  /**
   * `status: 'complete'` covers real page loads. `changeInfo.url` covers
   * `history.pushState`, which is how Reddit, GitHub and most of the modern web
   * navigate — those never reach `complete`, so watching only for it left the
   * badge showing the previous page indefinitely.
   */
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // A new document in this tab is a new page for the fetch cap below.
    if (changeInfo.status === 'loading') budget.forget(tabId)

    const { incognito } = tab
    if (changeInfo.url) {
      void update(tabId, changeInfo.url, { spa: changeInfo.status !== 'loading', incognito })
    } else if (changeInfo.status === 'complete') void update(tabId, tab.url, { incognito })
  })

  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.tabs
      .get(tabId)
      .then((tab) => update(tabId, tab.url, { incognito: tab.incognito }))
      // Activated and closed before this ran: there is no tab to describe.
      .catch(() => {})
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    generation.delete(tabId)
    budget.forget(tabId)
  })

  // Turning a setting off has to take effect on tabs already showing a badge or
  // an overlay, not just on the next navigation.
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.settings) return
    void syncMenu()
    void syncAnnotator()
    void sweep()
  })

  // ------------------------------------------------------- right-click a link

  const MENU_ID = 'pagedate-check-link'

  /**
   * Run each registration task one at a time, in call order.
   *
   * Both syncs below are read-modify-write against browser-global state, and
   * both are triggered from four places — install, startup, a settings change,
   * and worker start. Two overlapping runs each read the state, then each act
   * on what they read, and the second acts on something the first has already
   * changed: a registration made twice, or one removed by the run that lost.
   * `await` inside the function does not help; the interleaving is between
   * separate invocations, so the queue has to be outside them.
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
   * There is no way to ask which entries exist, and the worker is evicted and
   * restarted freely in MV3, so any flag it keeps about what it has already
   * registered is a guess. This used to settle that with `removeAll` and a
   * fresh `create` on every start — which left a moment with no entry at all,
   * on every wake, for a right-click to land in.
   *
   * So it creates, and treats "duplicate id" as the answer to the question it
   * could not ask: the entry is there already, and only its title — which
   * follows the browser's language — is refreshed. Nothing is torn down unless
   * the setting is off.
   *
   * `contextMenus` does not exist on Firefox for Android; hence the guard.
   */
  const syncMenu = (): Promise<void> =>
    menuQueue(async () => {
      const menus = browser.contextMenus
      if (!menus) return

      try {
        const { linkMenu } = await getSettings()
        if (!linkMenu) {
          await menus.remove(MENU_ID).catch(() => {})
          return
        }

        const title = t('menuCheckLink')
        await new Promise<void>((done) => {
          // The callback form, so `runtime.lastError` is read. `create` reports
          // failure only through it, and an unread lastError is logged by
          // Chrome as an unchecked error against the extension.
          menus.create({ id: MENU_ID, title, contexts: ['link'] }, () => {
            if (!browser.runtime.lastError) return done()
            void menus
              .update(MENU_ID, { title })
              .catch(() => {})
              .then(() => done())
          })
        })
      } catch {
        // A worker torn down mid-call.
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
   * The browser is asked what is registered, and the registration is changed
   * only if that differs from what is wanted. See lib/registration.ts for why
   * this is not the unregister-then-register it used to be.
   */
  const syncAnnotator = (): Promise<void> =>
    annotatorQueue(async () => {
      try {
        const { searchAnnotate } = await getSettings()

        // The grant can be revoked from the browser's own UI, and registering
        // against origins we do not hold throws.
        const held =
          searchAnnotate !== 'off' &&
          (await browser.permissions.contains({ origins: SEARCH_ORIGINS }).catch(() => false))

        const script = {
          id: ANNOTATOR_ID,
          js: [ANNOTATE_SCRIPT],
          matches: SEARCH_MATCHES,
          runAt: 'document_idle' as const,
        }

        const [existing] = await browser.scripting
          .getRegisteredContentScripts({ ids: [ANNOTATOR_ID] })
          .catch(() => [])

        switch (registrationPlan(existing, held ? script : null)) {
          case 'keep':
            return
          case 'unregister':
            await browser.scripting.unregisterContentScripts({ ids: [ANNOTATOR_ID] })
            return
          case 'register':
            await browser.scripting.registerContentScripts([script])
            return
          case 'replace':
            // In place: there is no moment at which nothing is registered.
            await browser.scripting.updateContentScripts([script])
        }
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
  // setting that depended on it down too, or the options page goes on showing
  // a feature as on that has stopped working. Saving the corrected settings
  // fires `storage.onChanged` above, which clears what the feature had drawn.
  browser.permissions.onRemoved?.addListener(() => {
    void reconcileGrants()
      .catch(() => {})
      .then(() => syncAnnotator())
  })
  browser.permissions.onAdded?.addListener(() => void syncAnnotator())

  /*
   * Optional-chained because this runs at the top level of the worker: on
   * Firefox for Android there is no `contextMenus`, and a TypeError here would
   * abort the script before the listeners below it were registered.
   *
   * The handler is synchronous up to the permission request, and has to be.
   * See `checkLink`.
   */
  browser.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !info.linkUrl || tab?.id === undefined) return
    onLinkClicked(info.linkUrl, tab.id)
  })

  /**
   * Origins this worker asked for on behalf of a click, and how many checks in
   * flight are relying on each. Two quick clicks on links to the same site
   * share one grant; it goes back when the last of them has its answer, not
   * when the first does.
   */
  const borrowed = new Map<string, number>()

  const hadOrigin = async (pattern: string): Promise<boolean> => {
    const others = borrowed.get(pattern)
    // Held only because an earlier click borrowed it: that is not "already had".
    const had =
      others === undefined &&
      (await browser.permissions.contains({ origins: [pattern] }).catch(() => true))
    if (!had) borrowed.set(pattern, (borrowed.get(pattern) ?? 0) + 1)
    return had
  }

  const releaseOrigin = async (pattern: string): Promise<void> => {
    const left = (borrowed.get(pattern) ?? 1) - 1
    if (left > 0) {
      borrowed.set(pattern, left)
      return
    }
    borrowed.delete(pattern)
    await browser.permissions.remove({ origins: [pattern] }).catch(() => false)
  }

  function onLinkClicked(linkUrl: string, tabId: number): void {
    const host = hostOf(linkUrl)

    // Chained, so the answer can never be painted before the "checking…" it
    // replaces and then be overwritten by it.
    let painting: Promise<void> = Promise.resolve()
    const toast = (data: ToastData): Promise<void> => {
      painting = painting.then(async () => {
        try {
          await browser.scripting.executeScript({ target: { tabId }, func: paintToast, args: [data] })
        } catch {
          // The page refuses injection. There is nowhere to put the answer, and
          // a notification would be a second permission for an edge case.
        }
      })
      return painting
    }

    // Called here, in the click's own tick: nothing may be awaited before the
    // permission request inside it. The settings are read afterwards.
    const outcome = checkLink(linkUrl, {
      hasOrigin: hadOrigin,
      requestOrigin: (pattern) => browser.permissions.request({ origins: [pattern] }),
      releaseOrigin,
      readPage: (url) => readLink(tabId, url),
      // Up to eight seconds can pass before there is an answer, and until now
      // they passed in silence.
      onReading: () => void toast(toastData(checkingToast(host), CHECKING_TTL_MS)),
    })

    void outcome
      .then(async (result) => {
        const { dateFormat } = await getSettings()
        await toast(toastData(toastFor(result, host, new Date(), dateFormat)))
      })
      .catch(() => {})
  }

  /** Built by WXT from `entrypoints/link-extract.ts`. Root-relative, per {@link EXTRACT_SCRIPT}. */
  const LINK_EXTRACT_SCRIPT = '/link-extract.js'

  /** Built by WXT from `entrypoints/annotate.content.ts`. */
  const ANNOTATE_SCRIPT = 'content-scripts/annotate.js'

  /**
   * Fetch a linked page here, and extract from it in the tab.
   *
   * The request is made by the worker because the grant only lifts CORS for
   * the extension's own contexts; the parse happens in the tab because the
   * worker has no `DOMParser`. See `fetchPageText`.
   *
   * Three injections, for the reason given in `lib/link-read.ts`:
   * `executeScript({ files })` accepts no arguments, so the request is written
   * into the isolated world first, the bundle reads it, and a third call reads
   * the answer back. All three land in the same isolated world, invisible to
   * the page.
   */
  async function readLink(tabId: number, url: string): Promise<Candidate[] | null> {
    try {
      const html = await fetchPageText(url)
      if (html === null) return null

      const request: LinkRequest = { url, html }
      await browser.scripting.executeScript({
        target: { tabId },
        func: (key: string, value: LinkRequest) => {
          ;(globalThis as unknown as Record<string, unknown>)[key] = value
        },
        args: [LINK_REQUEST_GLOBAL, request],
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

  // ------------------------------------------- fetching for the annotator

  const budget = fetchBudget()

  /**
   * Decide, then fetch. Every condition is in `refusal` — see
   * lib/fetch-relay.ts for what is being guarded and why.
   */
  async function relay(message: FetchRequest, sender: RelaySender): Promise<FetchReply> {
    const [settings, held] = await Promise.all([getSettings(), granted()])

    const refused = refusal(message, sender, {
      extensionId: browser.runtime.id,
      fetchTier: settings.searchAnnotate === 'fetch',
      granted: held,
    })
    if (refused || sender.tab?.id === undefined) return null
    if (!budget.take(sender.tab.id)) return null

    const html = await fetchPageText(message.url, { publicOnly: true })
    return html === null ? null : { html }
  }

  /*
   * `sendResponse` and `return true`, not a returned promise: that is the one
   * form of asynchronous reply both browsers have always understood.
   *
   * Only `onMessage` is listened to. Messages from web pages and from other
   * extensions arrive on `onMessageExternal`, which has no listener here, and
   * `refusal` checks the sender regardless.
   */
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isFetchRequest(message)) return
    void relay(message, sender).then(sendResponse, () => sendResponse(null))
    return true
  })

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

  // Housekeeping with the same cadence. The first is what makes "kept for
  // seven days" mean deleted rather than ignored; the second catches a grant
  // revoked while no listener was there to hear it.
  void pruneCache()
  void reconcileGrants().catch(() => {})
})
