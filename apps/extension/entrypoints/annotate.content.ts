import {
  chipFor,
  FETCH_CONCURRENCY,
  MAX_FETCHES_PER_PAGE,
  pooled,
  shouldFetch,
  type Chip,
} from '../lib/annotate.js'
import { dateFromUrl, dateFromFetch, makeTabFetcher, type LinkDate } from '../lib/link-date.js'
import { engineFor, resultLinks, targetOf } from '../lib/search-sites.js'
import { getSettings } from '../lib/settings.js'

/**
 * Ages next to search results.
 *
 * The feature that changes what this extension is for. Checking one page at a
 * time answers a question you already had; annotating a results list answers one
 * you did not know to ask — that the third hit is from 2013 — before you spend a
 * click finding out.
 *
 * A content script rather than an on-demand injection, which is the one place
 * this codebase departs from "inject only on a click". It has to be: there is no
 * click to hang it on, and the whole point is that the annotations are already
 * there when the results render.
 *
 * **`registration: 'runtime'` is load-bearing, not a build detail.** A content
 * script declared in the manifest contributes its `matches` to Chrome's
 * install-time permission prompt — "Read and change your data on google.com and
 * 4 other sites" — whether or not the feature is ever switched on. That would
 * break the promise the rest of this extension is built around and that the
 * options page states in its first paragraph. Registered at runtime instead, the
 * manifest stays empty of it, the origins live in `optional_host_permissions`,
 * and the background worker registers the script only once the setting is on and
 * the grant exists. See `syncAnnotator` in entrypoints/background.ts.
 *
 * Two tiers, and the difference between them is the entire privacy question.
 * The `url` tier reads addresses and contacts nobody. The `fetch` tier requests
 * result pages, which means this extension touching sites the reader has not
 * opened — capped, credential-free, and behind a second permission. See
 * lib/link-date.ts.
 */
export default defineContentScript({
  registration: 'runtime',
  matches: [],
  runAt: 'document_idle',

  async main() {
    const settings = await getSettings()
    if (settings.searchAnnotate === 'off') return

    const engine = engineFor(location.href)
    if (!engine) return

    const now = new Date()
    const fetcher = makeTabFetcher()

    /** Targets already annotated, so a re-run after scroll does no work twice. */
    const done = new Set<string>()
    let spent = 0

    const run = async (): Promise<void> => {
      const anchors = resultLinks(document, engine, location.href)

      /*
       * The free tier first, over every link, before a single request is made.
       * Ordering matters beyond tidiness: a dated permalink makes the fetch
       * unnecessary, and doing the cheap pass first is what keeps most results
       * off the network entirely.
       */
      const pending: { anchor: HTMLAnchorElement; url: string }[] = []

      for (const anchor of anchors) {
        const url = targetOf(anchor.href)
        if (done.has(url)) continue

        const fromUrl = dateFromUrl(url, now)
        if (fromUrl) {
          done.add(url)
          paint(anchor, chipFor(fromUrl, now, settings.dateFormat))
          continue
        }

        if (settings.searchAnnotate === 'fetch') pending.push({ anchor, url })
      }

      if (pending.length === 0) return

      // The cap is applied here, once, rather than checked inside the pool: it
      // has to bound what is *started*, and a pool that decided per task would
      // race itself on an infinite-scroll page.
      const budgeted = pending.filter(({ url }) => {
        if (!shouldFetch(url, null, spent, done)) return false
        spent++
        done.add(url)
        return true
      })

      await pooled(budgeted, FETCH_CONCURRENCY, async ({ anchor, url }) => {
        const dated: LinkDate | null = await dateFromFetch(url, fetcher, now)
        if (dated) paint(anchor, chipFor(dated, now, settings.dateFormat))
      })
    }

    await run()

    /*
     * Results pages add results — infinite scroll on DuckDuckGo, "more" on
     * Hacker News, and Google replacing the whole list on a filter change. A
     * mutation observer, debounced, keeps up without re-running per node.
     *
     * `done` is what makes re-running cheap and `spent` is what makes it safe:
     * the fetch budget is per page load, not per pass, so scrolling for ten
     * minutes cannot turn into a hundred requests.
     */
    let queued: ReturnType<typeof setTimeout> | undefined
    new MutationObserver(() => {
      clearTimeout(queued)
      queued = setTimeout(() => void run(), 400)
    }).observe(document.body, { childList: true, subtree: true })
  },
})

const CHIP_CLASS = 'pagedate-chip-8f2a'

const TONES: Record<Chip['tone'], string> = {
  declared: '#0f766e',
  derived: '#c2410c',
  inferred: '#5f6673',
  alert: '#b3261e',
}

/**
 * Put the chip after the result's title.
 *
 * Inline and inside the existing heading where there is one, so it moves with
 * the layout rather than being positioned against it. A results page reflows
 * constantly — that is what an ad slot loading does — and anything absolutely
 * placed ends up beside the wrong result.
 *
 * No shadow root here, unlike the overlay and the toast. Those land in the
 * middle of an unknown page and have to defend themselves; this is a small
 * inline span that *should* inherit the surrounding font metrics, and a shadow
 * boundary would cut it off from exactly the inheritance that makes it look
 * like part of the row. All styles are set inline, so the page's own CSS has
 * nothing to reach it by other than the class name.
 */
function paint(anchor: HTMLAnchorElement, chip: Chip | null): void {
  if (!chip) return

  const anchorParent = anchor.parentElement
  if (!anchorParent) return

  // Idempotent: the observer re-runs over links that are already annotated when
  // a sibling changes, and a chip appended twice is the classic symptom.
  const host = anchor.closest('h3, h2, .titleline, p, div') ?? anchorParent
  if (host.querySelector(`.${CHIP_CLASS}`)) return

  const span = document.createElement('span')
  span.className = CHIP_CLASS
  span.textContent = chip.text
  span.title = chip.title
  // The chip is supplementary to a link that already says where it goes, so it
  // is not announced separately; the title carries the detail for anyone who
  // wants it.
  span.setAttribute('aria-hidden', 'true')
  span.setAttribute(
    'style',
    [
      'display: inline-block',
      'margin-inline-start: 6px',
      'padding: 0 5px',
      'border-radius: 6px',
      'font: 500 11px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif',
      'vertical-align: middle',
      'color: #ffffff',
      `background: ${TONES[chip.tone]}`,
      // A results page is dense; the chip must read as an annotation on the row
      // rather than compete with the title it sits beside.
      'opacity: 0.92',
    ].join('; '),
  )

  anchor.after(span)
}
