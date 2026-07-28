import { extractFromDocument, resolve, type DateResult, type Env } from 'pagedate'
import { errorView, originOf, unsupportedView, view } from './render.js'

/**
 * Browser glue. All view logic lives in render.ts, which has no browser
 * dependency and is tested directly.
 *
 * Everything runs in the popup rather than a content script: the page is read
 * once, on your click, by pulling `documentElement.outerHTML` through
 * `activeTab`. That reflects the hydrated DOM, so single-page apps work without
 * a MutationObserver, and no script has to be injected into every page load.
 */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Bump to invalidate every cached result after a heuristics change. */
const CACHE_VERSION = 1

type CacheEntry = { result: DateResult; fetchedAt: number; version: number }

const app = document.getElementById('app') as HTMLElement

void main()

async function main(): Promise<void> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    const url = tab?.url

    if (!tab?.id || !url || !/^https?:/i.test(url)) {
      render(unsupportedView())
      return
    }

    const cached = await readCache(url)
    if (cached) {
      render(view(cached, url, true))
      return
    }

    const html = await readPageHtml(tab.id)
    if (html === null) {
      render(
        errorView(
          'Could not read this page. Browser settings pages and extension galleries are off limits to extensions.',
        ),
      )
      return
    }

    const doc = new DOMParser().parseFromString(html, 'text/html')
    const result = await resolve(extractFromDocument(doc, url), url, popupEnv(url))

    await writeCache(url, result)
    render(view(result, url, false))
  } catch (cause) {
    render(errorView(cause instanceof Error ? cause.message : String(cause)))
  }
}

/** Read the live DOM as HTML. Relies on the activeTab grant from the click. */
async function readPageHtml(tabId: number): Promise<string | null> {
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement.outerHTML,
    })
    return typeof injection?.result === 'string' ? injection.result : null
  } catch {
    return null
  }
}

/**
 * Network access for feed lookup.
 *
 * `activeTab` grants host permission for the current tab's origin — which is
 * exactly where a site's feed lives — so this works without ever requesting
 * <all_urls>. Cross-origin requests are refused rather than attempted.
 */
function popupEnv(pageUrl: string): Env {
  const origin = originOf(pageUrl)

  return {
    fetchText: async (url) => {
      if (originOf(url) !== origin) return null
      try {
        const response = await fetch(url, { credentials: 'omit' })
        return response.ok ? await response.text() : null
      } catch {
        return null
      }
    },
    parseXml: (xml) => {
      const parsed = new DOMParser().parseFromString(xml, 'application/xml')
      return parsed.querySelector('parsererror') ? null : parsed
    },
  }
}

function render(html: string): void {
  app.innerHTML = html
  document.getElementById('refresh')?.addEventListener('click', () => {
    void refresh()
  })
}

async function refresh(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.url) await browser.storage.local.remove(cacheKey(tab.url))
  app.innerHTML = '<div class="state">Reading page…</div>'
  await main()
}

const cacheKey = (url: string): string => `d:${url}`

async function readCache(url: string): Promise<DateResult | null> {
  try {
    const key = cacheKey(url)
    const stored = await browser.storage.local.get(key)
    const entry = stored[key] as CacheEntry | undefined
    if (!entry || entry.version !== CACHE_VERSION) return null
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null
    return entry.result
  } catch {
    return null
  }
}

async function writeCache(url: string, result: DateResult): Promise<void> {
  try {
    const entry: CacheEntry = { result, fetchedAt: Date.now(), version: CACHE_VERSION }
    await browser.storage.local.set({ [cacheKey(url)]: entry })
  } catch {
    // Storage full or unavailable — the result is still shown, just not cached.
  }
}
