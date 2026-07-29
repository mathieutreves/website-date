/**
 * Which pages are results pages, and where the results are on them.
 *
 * A table rather than a clever heuristic. "Find the links that look like search
 * results" is guesswork that goes wrong in the expensive direction — annotating
 * a nav bar is noise, but on the fetch tier it is also a request to a site
 * nobody asked about. Five engines with known markup is a smaller promise that
 * is actually kept.
 *
 * Selectors on someone else's redesign schedule are a maintenance cost with no
 * test that can catch the breakage, so each engine has a deliberately loose
 * selector plus a shared filter, and the failure mode is chosen: a selector that
 * stops matching annotates nothing, rather than annotating the wrong thing.
 * `resultLinks` returning empty is a normal state, not an error.
 */

export type SearchEngine = {
  id: string
  /** Host suffixes this engine serves from. Matched against the full hostname. */
  hosts: string[]
  /**
   * Narrows to the results region before anything else, so a sidebar, an ad
   * block or a "people also ask" panel is out of scope structurally rather than
   * by URL filtering after the fact.
   */
  container: string
  /** Result links within that region. */
  link: string
}

/**
 * Match patterns for the optional host permission these pages need, and for the
 * runtime content-script registration.
 *
 * One list for both on purpose. A registration whose `matches` exceeded the
 * grant would simply fail; one that fell short would leave an engine silently
 * unannotated with the permission already taken for it.
 */
export const SEARCH_ORIGINS = [
  '*://*.google.com/*',
  '*://*.bing.com/*',
  '*://duckduckgo.com/*',
  '*://news.ycombinator.com/*',
  '*://old.reddit.com/*',
]

/**
 * Narrower patterns for the injection itself.
 *
 * The permission has to cover a whole origin — that is the unit the browser
 * grants — but the script has no business running on Google Docs or a Bing map,
 * so it is registered only against the results paths. DuckDuckGo and Hacker News
 * serve results from `/`, so those stay broad.
 */
export const SEARCH_MATCHES = [
  '*://*.google.com/search*',
  '*://*.bing.com/search*',
  '*://duckduckgo.com/*',
  '*://news.ycombinator.com/*',
  '*://old.reddit.com/*',
]

export const ENGINES: SearchEngine[] = [
  {
    id: 'google',
    // Google serves from ~190 country domains. Matching `google.` as a label
    // rather than listing them is the only version of this that stays correct,
    // and `isSearchHost` anchors it so `google.evil.example` does not match.
    hosts: ['google'],
    container: '#search, #rso',
    // `h3` is the result title on every Google layout since 2018, and anchors
    // wrapping one are results rather than chrome.
    link: 'a[href]:has(h3)',
  },
  {
    id: 'bing',
    hosts: ['bing.com'],
    container: '#b_results',
    link: 'li.b_algo h2 a[href], li.b_algo a.tilk[href]',
  },
  {
    id: 'duckduckgo',
    hosts: ['duckduckgo.com'],
    container: '[data-area="mainline"], #links',
    link: 'a[data-testid="result-title-a"], a.result__a',
  },
  {
    id: 'hackernews',
    hosts: ['news.ycombinator.com'],
    container: '#hnmain',
    link: '.titleline > a[href]',
  },
  {
    id: 'reddit',
    // Old Reddit only. The current front end is a shadow-DOM single-page app
    // whose markup is neither stable nor reachable by a selector, and guessing
    // at it would produce exactly the wrong-link failure this table avoids.
    hosts: ['old.reddit.com'],
    container: '#siteTable',
    link: 'a.title[href]',
  },
]

/**
 * Does this hostname belong to the engine?
 *
 * An entry containing a dot is a domain suffix, matched exactly or as a parent.
 *
 * A bare entry — `google`, which exists because Google serves from about 190
 * country domains and listing them is the version of this that goes stale — is
 * the delicate one. It must match `www.google.co.uk` and `google.de`, and it
 * must **not** match `google.phishing.example`: an annotator that accepted that
 * would run its selectors on a page an attacker controls, and on the fetch tier
 * spend its request budget there.
 *
 * So a bare label matches only when everything following it is a public suffix:
 * one or two labels of two to four letters. `com`, `de`, `co.uk`, `com.au` pass;
 * `phishing.example` does not, because a registrable domain sitting after the
 * label means the label was a subdomain and the site is somebody else's.
 *
 * This is a heuristic standing in for the public suffix list, which is a
 * 15,000-line file that would have to ship and be kept current for a check this
 * far from the hot path. It errs toward refusing — a legitimate engine domain
 * with an unusual suffix is annotated by nothing, which is this feature's chosen
 * failure mode everywhere else too.
 */
const PUBLIC_SUFFIX_LABEL = /^[a-z]{2,4}$/

export function isSearchHost(hostname: string, engine: SearchEngine): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')

  return engine.hosts.some((pattern) => {
    if (pattern.includes('.')) return host === pattern || host.endsWith(`.${pattern}`)

    const labels = host.split('.')
    const at = labels.indexOf(pattern)
    if (at === -1) return false

    const suffix = labels.slice(at + 1)
    return (
      suffix.length >= 1 &&
      suffix.length <= 2 &&
      suffix.every((label) => PUBLIC_SUFFIX_LABEL.test(label))
    )
  })
}

export function engineFor(url: string): SearchEngine | null {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return null
  }
  return ENGINES.find((engine) => isSearchHost(hostname, engine)) ?? null
}

/**
 * Links worth dating on this page.
 *
 * Same-origin links are dropped: an engine's own pagination, settings and
 * "related searches" all live under its hostname, and none of them is a result.
 * That single rule removes most of what the selectors would otherwise
 * over-collect, which is why the selectors are allowed to stay loose.
 *
 * Duplicates are dropped by URL, keeping the first — the same target listed
 * twice should be annotated twice, but it should only be *fetched* once, and
 * the caller cannot dedupe what it never sees as a pair.
 */
export function resultLinks(doc: Document, engine: SearchEngine, pageUrl: string): HTMLAnchorElement[] {
  let ownHost: string
  try {
    ownHost = new URL(pageUrl).hostname
  } catch {
    return []
  }

  const roots = doc.querySelectorAll(engine.container)
  const found: HTMLAnchorElement[] = []

  for (const root of roots) {
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>(engine.link)) {
      const href = anchor.href
      if (!/^https?:/i.test(href)) continue

      try {
        if (new URL(href).hostname === ownHost) continue
      } catch {
        continue
      }

      found.push(anchor)
    }
  }

  return found
}

/**
 * Some engines rewrite result hrefs to a tracking redirect; the real target is
 * a query parameter on it. Reading that is not merely cosmetic — the URL tier
 * dates the *path*, and the path of a redirector carries no date at all, so
 * without this every such result falls through to a fetch it did not need.
 */
const REDIRECT_PARAMS = ['url', 'uddg', 'u', 'q']

export function targetOf(href: string): string {
  let parsed: URL
  try {
    parsed = new URL(href)
  } catch {
    return href
  }

  for (const key of REDIRECT_PARAMS) {
    const value = parsed.searchParams.get(key)
    if (!value || !/^https?:\/\//i.test(value)) continue
    try {
      return new URL(value).toString()
    } catch {
      continue
    }
  }

  return href
}
