import { extractFromDocument } from 'pagedate'
import { parseHtml } from '../lib/link-date.js'
import {
  LINK_REQUEST_GLOBAL,
  LINK_RESULT_GLOBAL,
  type LinkRead,
  type LinkRequest,
} from '../lib/link-read.js'

/**
 * Extract a linked page's dates from markup the worker fetched — in the tab,
 * where a parser exists.
 *
 * The sibling of `extract.ts`. That one reads the document the browser has
 * already built; this one has to build its own, because the page in question
 * has not been visited. Both run here rather than in the service worker for the
 * same reason: Chrome's MV3 worker has no `DOMParser`, and shipping one would
 * mean bundling a parser into an extension whose entire premise is that the
 * browser already has a better one.
 *
 * It does not fetch. A request made from here is made under the page's CORS
 * policy, so the worker makes it and hands the text over — see `fetchPageText`
 * in lib/link-date.ts.
 *
 * Only the candidate list travels back.
 */
export default defineUnlistedScript(() => {
  const world = globalThis as unknown as Record<string, unknown>
  const request = world[LINK_REQUEST_GLOBAL] as Partial<LinkRequest> | undefined
  // The markup is up to a couple of megabytes of somebody else's page, and
  // this world lives as long as the tab does.
  delete world[LINK_REQUEST_GLOBAL]

  const url = typeof request?.url === 'string' ? request.url : ''
  const read: LinkRead = { url, candidates: null }

  if (/^https?:/i.test(url) && typeof request?.html === 'string') {
    const doc = parseHtml(request.html)
    // `null` candidates means "could not read the page", which is a different
    // answer from an empty list — "read it, it says nothing". The toast
    // distinguishes them, so the extractor must not flatten them here.
    if (doc) read.candidates = extractFromDocument(doc, url)
  }

  world[LINK_RESULT_GLOBAL] = read
})
