import { analyze } from '../lib/analyze.js'
import { badgeFor } from '../lib/badge.js'
import { AUTO_READ_ORIGINS, getSettings } from '../lib/settings.js'

/**
 * Optional background pass: read each page as you browse and put its age on the
 * toolbar icon, so the common case needs no click at all.
 *
 * This is off by default and does nothing until two things are true — the
 * setting is on *and* the `<all_urls>` grant exists. Neither is requested at
 * install time; the toggle in the options page asks for the grant at the moment
 * it is switched on, and gives it back when it is switched off. That is what
 * lets the extension keep asking for nothing up front while still offering the
 * always-on behaviour to people who want it.
 *
 * The read itself is the same `analyze()` the popup uses, against the same
 * cache — so the badge and the panel can never report different things.
 */
export default defineBackground(() => {
  const enabled = async (): Promise<boolean> => {
    const settings = await getSettings()
    if (!settings.autoRead) return false
    try {
      return await browser.permissions.contains({ origins: AUTO_READ_ORIGINS })
    } catch {
      return false
    }
  }

  async function updateBadge(tabId: number, url: string | undefined): Promise<void> {
    if (!url || !/^https?:/i.test(url)) {
      await clearBadge(tabId)
      return
    }
    if (!(await enabled())) {
      await clearBadge(tabId)
      return
    }

    const analysis = await analyze(tabId, url)
    if ('error' in analysis) {
      await clearBadge(tabId)
      return
    }

    const badge = badgeFor(analysis.result, new Date())
    try {
      await browser.action.setBadgeText({ tabId, text: badge.text })
      await browser.action.setBadgeBackgroundColor({ tabId, color: badge.color })
      await browser.action.setTitle({ tabId, title: `Page Date — ${badge.title}` })
    } catch {
      // A tab that closed mid-analysis. Nothing to report to.
    }
  }

  async function clearBadge(tabId: number): Promise<void> {
    try {
      await browser.action.setBadgeText({ tabId, text: '' })
      await browser.action.setTitle({ tabId, title: 'Page Date' })
    } catch {
      // Tab is gone.
    }
  }

  // `complete` rather than `loading`: the point of reading the live DOM is to
  // catch what the page rendered, which is not there yet mid-load.
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') void updateBadge(tabId, tab.url)
  })

  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.tabs.get(tabId).then((tab) => updateBadge(tabId, tab.url))
  })

  // Turning the setting off has to take effect on tabs already showing a badge,
  // not just on the next navigation.
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.settings) return
    void browser.tabs.query({}).then(async (tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) await updateBadge(tab.id, tab.url)
      }
    })
  })
})
