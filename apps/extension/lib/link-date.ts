import {
  extractFromDocument,
  extractUrlSlug,
  isSafeFetchTarget,
  resolveCandidates,
  type Candidate,
  type DateResult,
} from 'pagedate'

/**
 * Dating a page you are not on.
 *
 * Both new surfaces need this — the right-click check on a link, and the
 * annotations on a search results page — and both face the same problem: the
 * extension's whole design rests on reading the DOM that already exists, and
 * here there is no such DOM. The page in question has not been visited.
 *
 * So there are two tiers, and the gap between them is the entire privacy story.
 *
 * **`url`** reads the address and nothing else. `/2019/03/04/some-post/` is a
 * date, and no request is made to learn it. It is free, instant, needs no
 * permission, and tells nobody anything — the extension never touches the site.
 * It also answers only for sites that mint dated permalinks, which is most
 * blogs and news and almost no documentation.
 *
 * **`fetch`** requests the page and reads its metadata properly. It answers far
 * more often, and it costs a request to a site the reader has not chosen to
 * visit. On a search results page that means the extension contacting ten
 * sites because ten links happened to be on screen, which is a materially
 * different proposition from anything else this extension does, and it is why
 * the fetch tier is opt-in, capped, and asks for its own permission.
 *
 * Everything here is pure apart from the injected `fetchDocument` and the
 * injectable `fetch`, so both tiers are testable without a browser.
 */

export type LinkTier = 'url' | 'fetch'

export type LinkDate = {
  url: string
  result: DateResult
  /** Which tier produced it. `url` results are inferred and should read as such. */
  tier: LinkTier
}

/**
 * Date a URL from its own text. No network, no permission, no document.
 *
 * Returns `null` rather than an empty result when the path carries no date, so
 * callers can tell "nothing here" from "a date of unknown value" without
 * inspecting the candidate list.
 */
export function dateFromUrl(url: string, now: Date = new Date()): LinkDate | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const candidates = extractUrlSlug(parsed)
  if (candidates.length === 0) return null

  const result = resolveCandidates(candidates, { now })
  if (!result.published && !result.modified) return null

  return { url, result, tier: 'url' }
}

/**
 * Fetch a page and read its dates the way the popup would.
 *
 * `fetchDocument` is injected because *where* each half runs is the whole
 * point. The parse must happen in a tab: Chrome's MV3 worker has no
 * `DOMParser`, and shipping one to work around that would mean bundling a
 * parser into an extension whose entire premise is that the browser already has
 * one. The request must happen in the worker: a tab's `fetch` answers to the
 * page's CORS policy. See {@link fetchPageText}.
 *
 * No `Env` is passed to the resolver, so no feed and no sitemap are consulted:
 * one request per link is the budget, and a link check that quietly became
 * three requests would break the accounting the caps depend on.
 */
export async function dateFromFetch(
  url: string,
  fetchDocument: (url: string) => Promise<Document | null>,
  now: Date = new Date(),
): Promise<LinkDate | null> {
  const doc = await fetchDocument(url).catch(() => null)
  if (!doc) return null

  return dateFromCandidates(url, extractFromDocument(doc, url), now)
}

/**
 * Rank candidates that were extracted somewhere else.
 *
 * The service worker's half of the same job. A `Document` cannot cross a
 * structured-clone boundary, so when the extraction happens in a tab — which is
 * the only place it can happen, since Chrome's MV3 worker has no `DOMParser` —
 * what comes back is the candidate list. Ranking is pure and needs no DOM, so
 * it is free to happen at either end.
 */
export function dateFromCandidates(
  url: string,
  candidates: Candidate[],
  now: Date = new Date(),
): LinkDate | null {
  const result = resolveCandidates(candidates, { now })
  if (!result.published && !result.modified) return null

  return { url, result, tier: 'fetch' }
}

/**
 * The best available reading, cheapest first.
 *
 * The URL tier runs first even when fetching is allowed, and a hit short-
 * circuits the request. A dated permalink is a fact the site minted about its
 * own post; fetching the page to confirm what its address already says is a
 * request that buys precision the reader did not ask for. On a results page of
 * ten links this is typically most of them.
 */
export async function dateLink(
  url: string,
  options: {
    fetchDocument?: ((url: string) => Promise<Document | null>) | undefined
    now?: Date
  } = {},
): Promise<LinkDate | null> {
  const now = options.now ?? new Date()

  const fromUrl = dateFromUrl(url, now)
  if (fromUrl) return fromUrl
  if (!options.fetchDocument) return null

  return await dateFromFetch(url, options.fetchDocument, now)
}

/**
 * How much of a page is read. Dates live in the head and in the first screens
 * of markup, so a body cut off here still parses and still answers; what the
 * cap prevents is a link to a 400 MB log file being pulled through the worker
 * and posted into a tab in one piece.
 */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024

export type FetchPageOptions = {
  timeoutMs?: number
  maxBytes?: number
  /**
   * Refuse a URL, or a redirect's destination, that `isSafeFetchTarget`
   * rejects. Set wherever the URL was chosen by a page rather than by the
   * reader — see lib/fetch-relay.ts.
   */
  publicOnly?: boolean
  fetchImpl?: typeof fetch
}

/**
 * Fetch a page's markup as text. Runs in the background worker, and only there.
 *
 * This used to be a `fetch` in the tab, beside the `DOMParser` that reads the
 * answer, and it could not work: a content script's requests are subject to
 * the *page's* CORS policy whatever host permissions the extension holds, so
 * every cross-origin read — which is nearly every link anyone right-clicks,
 * and every search result by definition — failed after the reader had granted
 * the permission for it. Host permissions lift CORS for the extension's own
 * contexts, and the worker is one.
 *
 * So the job is split along the line each half can do: the worker, which may
 * make the request, fetches text; the tab, which has a parser, turns it into a
 * document ({@link parseHtml}). The markup crosses one boundary as a string,
 * which is the copy `extract.ts` exists to avoid for the page already on
 * screen and cannot be avoided for one that is not.
 */
export async function fetchPageText(url: string, options: FetchPageOptions = {}): Promise<string | null> {
  const { timeoutMs = 8000, maxBytes = MAX_PAGE_BYTES, publicOnly = false } = options
  const doFetch = options.fetchImpl ?? fetch

  if (!/^https?:/i.test(url)) return null
  if (publicOnly && !isSafeFetchTarget(url)) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await doFetch(url, {
      // No cookies. The point is to read a public page, not to see the
      // reader's logged-in view of it — and sending credentials to a site
      // the reader has not visited is exactly the thing this must not do.
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) return null

    // `fetch` cannot be asked to vet each hop, only to follow or not, so a
    // redirect is judged by where it ended up. The request has been made by
    // then; what this withholds is the body.
    if (publicOnly && response.url && !isSafeFetchTarget(response.url)) return null

    const type = response.headers.get('content-type') ?? ''
    // A PDF or an image would parse into an empty document and read as "no
    // date here", which is a different and less honest answer than "this is
    // not a page I can read".
    if (type && !/^\s*text\/html|^\s*application\/xhtml/i.test(type)) return null

    return await readCapped(response, maxBytes)
  } catch {
    return null
  } finally {
    // Also stops a body still streaming when the cap was reached.
    controller.abort()
    clearTimeout(timer)
  }
}

/**
 * The body as text, stopping at `maxBytes`. Decoded as UTF-8, which is what
 * `response.text()` does too; the dates being looked for are ASCII in every
 * encoding a page is likely to be served in.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return (await response.text()).slice(0, maxBytes)

  const decoder = new TextDecoder()
  let text = ''
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const room = maxBytes - received
    if (value.byteLength >= room) {
      text += decoder.decode(value.subarray(0, room))
      await reader.cancel().catch(() => {})
      return text
    }
    received += value.byteLength
    text += decoder.decode(value, { stream: true })
  }

  return text + decoder.decode()
}

/**
 * Parse fetched markup into a Document, in a context that has a real parser —
 * a tab. `text/html` rather than `text/xml`: an HTML parser applied to
 * real-world markup recovers from the tag soup that a strict XML parse rejects
 * outright, and this is being handed whatever the open web returns.
 *
 * The result is inert: a document made by `DOMParser` runs no script and loads
 * no subresource, so parsing a stranger's page inside a tab executes nothing.
 */
export function parseHtml(html: string): Document | null {
  try {
    return new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return null
  }
}

/** Host-permission pattern for one URL's origin, for a just-in-time request. */
export function originPattern(url: string): string | null {
  try {
    const { protocol, host } = new URL(url)
    if (protocol !== 'http:' && protocol !== 'https:') return null
    return `${protocol}//${host}/*`
  } catch {
    return null
  }
}
