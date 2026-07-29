import { extractFromDocument } from 'pagedate'
import { makeTabFetcher } from '../lib/link-date.js'
import { LINK_REQUEST_GLOBAL, LINK_RESULT_GLOBAL, type LinkRead } from '../lib/link-read.js'

/**
 * Fetch a linked page and extract its dates — in the tab, where a DOM exists.
 *
 * The sibling of `extract.ts`. That one reads the document the browser has
 * already built; this one has to build its own, because the page in question
 * has not been visited. Both run here rather than in the service worker for the
 * same reason: Chrome's MV3 worker has no `DOMParser`, and shipping one would
 * mean bundling a parser into an extension whose entire premise is that the
 * browser already has a better one.
 *
 * Only the candidate list travels back. A `Document` cannot cross a
 * structured-clone boundary at all, and the markup could — but sending a whole
 * page across two message hops to re-parse it at the other end is precisely the
 * waste `extract.ts` exists to avoid.
 */
export default defineUnlistedScript(async () => {
  const world = globalThis as unknown as Record<string, unknown>
  const url = world[LINK_REQUEST_GLOBAL]

  const read: LinkRead = { url: typeof url === 'string' ? url : '', candidates: null }

  if (typeof url === 'string' && /^https?:/i.test(url)) {
    const doc = await makeTabFetcher()(url)
    // `null` candidates means "could not read the page", which is a different
    // answer from an empty list — "read it, it says nothing". The toast
    // distinguishes them, so the extractor must not flatten them here.
    if (doc) read.candidates = extractFromDocument(doc, url)
  }

  world[LINK_RESULT_GLOBAL] = read
})
