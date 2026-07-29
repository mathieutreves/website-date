import { extractFromDocument } from 'pagedate'
import { PAGE_READ_GLOBAL, type PageRead } from '../lib/page-read.js'

/**
 * Extraction, run where the DOM already is.
 *
 * This is the whole point of a browser-first library. The alternative is to read
 * `document.documentElement.outerHTML` out of the tab, move that string across
 * one or two message boundaries, and rebuild a second DOM from it with
 * `DOMParser` — reparsing a page the browser has already parsed. On the
 * benchmark corpus that string is a median of 88 KB and reaches 1.3 MB, and
 * every hop is a full copy of it.
 *
 * Injected on demand rather than declared in the manifest: an extension that
 * loads code into every page you visit is a different privacy proposition from
 * one that loads it into the page you asked about. This runs on a click, or on
 * a navigation the reader opted into.
 *
 * What travels back is a handful of candidate objects instead of the document.
 * That is also why nothing downstream needs a DOM, and why the service worker
 * can resolve without borrowing one — see lib/analyze.ts.
 */
export default defineUnlistedScript(() => {
  const read: PageRead = {
    // No `mode` — the default is `standard`, which is what the accuracy figures
    // in the README describe. Stated here only because a future reader will
    // wonder: `fast` buys ~2 ms and costs 22 points, and the DOM is already
    // built by the time this runs, so there is nothing to save.
    candidates: extractFromDocument(document, location.href),
    href: location.href,
  }

  // Deliberately not `window`: in a content script this is the isolated world,
  // so the page cannot see or forge it.
  ;(globalThis as unknown as Record<string, unknown>)[PAGE_READ_GLOBAL] = read
})
