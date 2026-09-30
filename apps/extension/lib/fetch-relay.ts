import { isSafeFetchTarget } from 'pagedate'
import { MAX_FETCHES_PER_PAGE } from './annotate.js'
import { engineFor } from './search-sites.js'

/**
 * The gate on the worker's "fetch this page for me" message.
 *
 * The search-results annotator runs in a results page and needs the markup of
 * the pages listed on it. It cannot fetch them itself — a content script's
 * requests answer to the page's CORS policy — so it asks the worker, whose
 * requests the all-sites grant exempts.
 *
 * That makes the handler a fetch primitive: something that, given a URL,
 * requests it from a privileged context and hands back the body. Left open, it
 * is the most dangerous thing in this extension, so everything about who may
 * call it and for what is decided here, in one pure function, rather than
 * spread through a listener.
 *
 * Who: only this extension's own content script, running in the top frame of a
 * tab that is showing one of the five search engines. Not another extension,
 * not an extension page, not a frame embedded in a results page.
 *
 * What: only a public http(s) address. A results page is attacker-influenced
 * text — anyone can get a link listed — and `http://192.168.0.1/` on it must
 * not become a request to the reader's router from inside their network.
 *
 * When: only while the reader has the fetch tier switched on and the grant
 * that goes with it, and only ten times per page.
 */

export const FETCH_MESSAGE = 'pagedate:fetch-page'

export type FetchRequest = { type: typeof FETCH_MESSAGE; url: string }
/** Text only. Headers, status and the final URL stay in the worker. */
export type FetchReply = { html: string } | null

/** The parts of `runtime.MessageSender` the decision rests on. */
export type RelaySender = {
  id?: string | undefined
  url?: string | undefined
  frameId?: number | undefined
  tab?: { id?: number | undefined } | undefined
}

export const isFetchRequest = (message: unknown): message is FetchRequest =>
  typeof message === 'object' &&
  message !== null &&
  (message as FetchRequest).type === FETCH_MESSAGE &&
  typeof (message as FetchRequest).url === 'string'

export type RelayContext = {
  /** `browser.runtime.id`. */
  extensionId: string
  /** The `searchAnnotate` setting is `fetch`. */
  fetchTier: boolean
  /** The all-sites grant is held right now. */
  granted: boolean
}

export type RelayRefusal = 'sender' | 'target' | 'disabled'

/** Why a request is refused, or `null` if it may proceed to the budget. */
export function refusal(
  message: FetchRequest,
  sender: RelaySender,
  context: RelayContext,
): RelayRefusal | null {
  if (sender.id !== context.extensionId) return 'sender'
  if (sender.tab?.id === undefined) return 'sender'
  // The annotator is registered for the top frame only. A message from a
  // subframe is not one it sent.
  if (sender.frameId !== undefined && sender.frameId !== 0) return 'sender'
  if (!sender.url || !/^https?:/i.test(sender.url) || !engineFor(sender.url)) return 'sender'

  if (!/^https?:/i.test(message.url) || !isSafeFetchTarget(message.url)) return 'target'

  if (!context.fetchTier || !context.granted) return 'disabled'
  return null
}

/**
 * The per-page cap, held where the requests are made.
 *
 * The content script counts too, and its count is the one that normally
 * decides — it knows which ten results come first. This is the same limit
 * enforced on the side that does not take the caller's word for it.
 *
 * A "page" is one document load in one tab: the worker forgets a tab's count
 * when that tab starts loading, which is when the content script's own count
 * starts again too. The count lives in the worker's memory, so a worker that
 * idles out and restarts forgets it; the content script's does not reset with
 * it, which is why this is the second line and not the only one.
 */
export function fetchBudget(limit: number = MAX_FETCHES_PER_PAGE) {
  const spent = new Map<number, number>()

  return {
    /** Take one fetch from the tab's budget. `false` when it is used up. */
    take(tabId: number): boolean {
      const count = spent.get(tabId) ?? 0
      if (count >= limit) return false
      spent.set(tabId, count + 1)
      return true
    },
    /** A new page load, or the tab closing. */
    forget(tabId: number): void {
      spent.delete(tabId)
    },
  }
}
