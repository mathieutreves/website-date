/**
 * The corpus manifest: what a benchmark page is, and what makes its label
 * trustworthy.
 *
 * Two decisions shape this file.
 *
 * **Labels carry their provenance.** A date-extraction benchmark is easy to get
 * circular: label a page from its `<meta>` tags and you have built a test that
 * measures how well you read `<meta>` tags. Every entry therefore records the
 * channel its label came from and, in `holdOut`, the extractor sources that must
 * be disabled when scoring against it. A page labelled from its URL cannot score
 * `url-slug`.
 *
 * **Pages are pinned to archive snapshots, not to live URLs.** htmldate's
 * published corpus covers 1000 pages; ~55 are still fetchable, because it points
 * at the live web and the live web rotted. Pinning to a Wayback timestamp makes
 * the corpus reconstructible indefinitely, and means this manifest — a few MB of
 * metadata — can be committed and cited while the HTML itself never is.
 */

import { createHash } from 'node:crypto'
import { rename, writeFile } from 'node:fs/promises'

/**
 * Where a label came from. Each is independent of *some* extractor channels and
 * entangled with others; `holdOut` records which.
 */
export type LabelSource =
  /** Date encoded in the URL path: `/2019/08/05/slug`. Independent of markup. */
  | 'url-permalink'
  /** `<pubDate>` from the site's own feed. Entangled with meta tags via the CMS. */
  | 'feed'
  /** Read from rendered text by a model, then reviewed. The gold tier. */
  | 'adjudicated'
  /** Asserted to have no publication date at all — a negative example. */
  | 'none'

/** How much of the date the label actually pins down. Never inflated. */
export type LabelPrecision = 'day' | 'month' | 'year'

/**
 * Auto-labelled or human-checked. `silver` is for regression and per-stratum
 * coverage; only `gold` should appear in a headline number.
 */
export type LabelTier = 'silver' | 'gold'

export type CorpusEntry = {
  /** Stable across runs: derived from the URL alone. */
  id: string
  url: string
  /** Wayback capture, `YYYYMMDDhhmmss`. The earliest good capture we found. */
  snapshot: string
  /**
   * Days between the labelled publication date and the capture.
   *
   * A page archived years after it was published is not the page that was
   * published: comments accumulate, sidebars fill with newer headlines, and
   * "updated" banners appear. Those later dates are what an extractor will find,
   * so a large lag makes the entry genuinely ambiguous rather than simply hard.
   * Recorded rather than filtered, because the right threshold depends on what
   * is being measured — but a headline number should use a tight one.
   */
  captureLagDays: number
  /**
   * Raw original bytes, not the replay. The `id_` modifier is what makes this a
   * usable benchmark artifact: without it Wayback injects its own banner and
   * rewrites links, and you are parsing a page that never existed.
   */
  archiveUrl: string

  label: {
    /** `YYYY-MM-DD`, truncated to `precision`. Null for a negative example. */
    published: string | null
    precision: LabelPrecision
    source: LabelSource
    tier: LabelTier
    /** Free text: the URL segment, feed entry, or evidence span behind it. */
    evidence?: string
  }

  /**
   * `Candidate.source` values that must be excluded before scoring this entry.
   * Ignoring this field is what makes a corpus measure itself.
   */
  holdOut: string[]

  strata: {
    host: string
    /** Registrable suffix, a cheap proxy for region before language is known. */
    tld: string
    /** Publication year, so pre-2010 markup can be reported separately. */
    era: number | null
    /** Filled by a later enrichment pass that needs the fetched HTML. */
    lang?: string
    pageType?: string
    signals?: string[]
    /** Does the label date appear in the page at all? Set by enrich.ts. */
    labelInPage?: boolean
    /**
     * Which seed frame put this host in the corpus.
     *
     * `hand` is the original `scripts/corpus/seeds.txt` — a list of sites its
     * author thought of, which is a bias no amount of careful labelling
     * downstream can undo, because it decides which pages exist to be labelled.
     * `tranco` is `corpus/seeds-tranco.txt`, produced by probing a published
     * domain ranking that nobody here curated.
     *
     * Recorded per entry rather than argued about in prose, so "how much of this
     * result rests on the hand-picked sites" is a query rather than an opinion.
     */
    frame?: 'hand' | 'tranco'
  }

  http: {
    status: number
    mime: string
    /** Wayback's content digest, for detecting a changed capture. */
    digest: string
    length: number
  }

  /** Set by fetch.ts once the snapshot is on disk. */
  fetch?: {
    at: string
    bytes: number
    /** sha256 of the stored file, so a rebuilt corpus is verifiably identical. */
    sha256: string
  }
}

/**
 * Which pool a host belongs to. Three, not two.
 *
 * `dev` is tuned against freely. `test` is the held-out set and is scored once,
 * at the end. `diag` sits between them and exists because a two-way split makes
 * its own failures unreadable: when a language or a template scores badly on
 * `test`, the only way to find out why is to open the pages — and opening them
 * is exactly what makes the split stop being held out. Every such question was
 * therefore unanswerable, and the corpus could show that Japanese scored 62.5%
 * without anyone being allowed to learn why.
 *
 * `diag` is a pool you MAY read, investigate and fix against, reported
 * separately and never quoted as a headline. It buys back the ability to
 * diagnose at the cost of a sixth of the corpus.
 *
 * **It is not a second held-out set.** The hosts carved into it come from the
 * historical `dev` side, so anything already tuned on stayed tuned on; what
 * makes it useful is that hosts entering the corpus later land in it clean.
 *
 * The `test` predicate is deliberately unchanged from the two-way version —
 * `digest[0] % 3` — so every held-out figure ever published from this corpus
 * remains a figure about the same set of hosts. Only the dev side is subdivided,
 * using an independent byte.
 */
export type Split = 'dev' | 'diag' | 'test'

export function splitOf(host: string): Split {
  const digest = createHash('sha1').update(host).digest()
  if (digest[0] % 3 === 0) return 'test'
  return digest[1] % 4 === 0 ? 'diag' : 'dev'
}

export const entryId = (url: string): string =>
  createHash('sha1').update(url).digest('hex').slice(0, 16)

export const archiveUrl = (snapshot: string, url: string): string =>
  `https://web.archive.org/web/${snapshot}id_/${url}`

/** `YYYYMMDDhhmmss` → `YYYY-MM-DD`. */
export const snapshotDay = (snapshot: string): string =>
  `${snapshot.slice(0, 4)}-${snapshot.slice(4, 6)}-${snapshot.slice(6, 8)}`

/** Real calendar date, and not in the future or before the web. */
function isRealDate(y: number, m: number, d: number): boolean {
  if (y < 1995 || y > new Date().getUTCFullYear()) return false
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * Paths that carry a date but are not an article.
 *
 * Date-based *listing* pages (`/2005/10/12/`) and paginated archives
 * (`/2019/06/08/slug/page/58/`) both match a naive permalink pattern, and both
 * are the wrong kind of page: a listing has no publication date of its own, and
 * a paginated archive's date belongs to whichever post happens to head it.
 * Sampling either would poison the corpus with labels no extractor should agree
 * with.
 */
const PAGINATION = /\/(page|comment-page)\/\d+\/?$/i

/**
 * CMS endpoints hanging off an article's permalink.
 *
 * WordPress exposes `/trackback/`, `/feed/`, `/embed/` and `/attachment/` under
 * the post URL, so they inherit a date-shaped path while serving XML, a
 * fragment, or an image page. They are the single largest source of false
 * matches in a raw CDX harvest.
 */
const FEED_LIKE = /\/(feed|rss|atom|amp|print|comments|trackback|embed|attachment)\/?$/i

/** Slug shapes that mean "index of that day", not "a post from that day". */
const NOT_A_SLUG = /^(index|page|all|archive|amp)(\.\w+)?$/i

export type PermalinkLabel = {
  published: string
  precision: LabelPrecision
  evidence: string
}

/**
 * Read a publication date out of a URL path, or refuse.
 *
 * This is the highest-value label source available: exact to the day, free at
 * enormous scale, and — crucially — derived from something no HTML extractor
 * reads, provided `url-slug` is held out when scoring.
 *
 * Returns null far more often than it matches. That is the point; a permissive
 * version of this function produces a large corpus of wrong answers.
 */
export function parsePermalinkDate(rawUrl: string, allowMonth = false): PermalinkLabel | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }

  // A permalink does not need a query string, and CDX is full of captures where
  // one encodes crawl-time state. Anything carrying one is not a clean sample.
  if (parsed.search) return null

  const path = parsed.pathname
  // Wayback holds a long tail of malformed captures — `/&quot/page/2009/06/08/…`
  // is a real row from techcrunch.com. Reject anything that did not survive
  // encoding intact rather than trying to repair it.
  if (/[<>"'&]|%25|%22/.test(path)) return null
  if (path.length > 240) return null
  if (PAGINATION.test(path) || FEED_LIKE.test(path)) return null

  const segments = path.split('/').filter(Boolean)

  // `/YYYY/MM/DD/slug…`
  for (let i = 0; i + 3 < segments.length; i++) {
    const [y, m, d] = [segments[i], segments[i + 1], segments[i + 2]]
    if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) continue
    const [year, month, day] = [Number(y), Number(m), Number(d)]
    if (!isRealDate(year, month, day)) continue

    const slug = segments[i + 3]
    if (!slug || NOT_A_SLUG.test(slug)) continue
    // A bare number after the date is a page index or an ID, not a title.
    if (/^\d+$/.test(slug)) continue

    return {
      published: `${year}-${pad(month)}-${pad(day)}`,
      precision: 'day',
      evidence: `/${y}/${m}/${d}/${slug}`,
    }
  }

  // `/YYYY-MM-DD-slug` and `/YYYY-MM-DD/slug`
  for (const segment of segments) {
    const match = /^(\d{4})-(\d{2})-(\d{2})([-_.].+)?$/.exec(segment)
    if (!match) continue
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
    if (!isRealDate(year, month, day)) continue
    const isLast = segments[segments.length - 1] === segment
    // Bare `/2019-08-05/` at the end of a path is a daily archive page.
    if (!match[4] && isLast) continue
    return {
      published: `${year}-${pad(month)}-${pad(day)}`,
      precision: 'day',
      evidence: `/${segment}`,
    }
  }

  if (!allowMonth) return null

  // `/YYYY/MM/slug` — real, but weaker: month precision, and far more likely to
  // be a monthly archive index than a post.
  for (let i = 0; i + 2 < segments.length; i++) {
    const [y, m] = [segments[i], segments[i + 1]]
    if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m)) continue
    const [year, month] = [Number(y), Number(m)]
    if (!isRealDate(year, month, 1)) continue
    const slug = segments[i + 2]
    if (!slug || NOT_A_SLUG.test(slug) || /^\d+$/.test(slug)) continue
    return { published: `${year}-${pad(month)}`, precision: 'month', evidence: `/${y}/${m}/${slug}` }
  }

  return null
}

/**
 * A page cannot be archived before it is published.
 *
 * The cheapest available check on an auto-generated label, and it catches the
 * common failure directly: a path segment that looks like a date but is a
 * product code, a version, or a reused permalink. One day of slack absorbs
 * timezone skew between the publisher and the crawler.
 */
export function labelPrecedesCapture(published: string, snapshot: string): boolean {
  const captured = snapshotDay(snapshot)
  const slack = new Date(`${published}T00:00:00Z`)
  slack.setUTCDate(slack.getUTCDate() - 1)
  return slack.toISOString().slice(0, 10) <= captured
}

export function readManifest(text: string): CorpusEntry[] {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CorpusEntry)
}

export const writeManifest = (entries: CorpusEntry[]): string =>
  entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'

/**
 * Write via a temp file and rename, so an interrupted run cannot truncate the
 * manifest.
 *
 * Both harvest and fetch rewrite the whole file periodically, and both are
 * expected to be killed partway — a laptop closing mid-write would otherwise
 * leave a half-written manifest and lose hours of harvesting. `rename` is
 * atomic within a filesystem, so the file is either the old one or the new one.
 */
export async function writeFileAtomic(path: string, contents: string): Promise<void> {
  const temp = `${path}.tmp`
  await writeFile(temp, contents)
  await rename(temp, path)
}
