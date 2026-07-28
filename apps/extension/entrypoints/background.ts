import { analyze } from '../lib/analyze.js'
import { badgeFor } from '../lib/badge.js'
import { clearOverlay, overlayData, paintOverlay } from '../lib/overlay.js'
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
      await browser.action.setTitle({ tabId, title: `Page Date — ${badge.title}` })
    } catch {
      // A tab that closed mid-analysis. Nothing to report to.
    }

    const data = overlayData(
      analysis.result,
      new Date(),
      settings.overlay,
      settings.overlayPosition,
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
      await browser.action.setTitle({ tabId, title: 'Page Date' })
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
})
