import type { Candidate, Confidence, DateResult, Env, Mode } from './types.js'
import type { DayFirstHint } from './parse/locale.js'

import type { ParseOptions } from './parse/normalize.js'
import { detectDayFirst } from './parse/locale.js'
import { extractBareText } from './extract/bareText.js'
import { extractFeed } from './extract/feed.js'
import { extractHttpHeaders } from './extract/headers.js'
import { extractImagePath } from './extract/imagePath.js'
import { isBodyScraped, isIndexPage } from './extract/indexPage.js'
import { extractInlineState } from './extract/inlineState.js'
import { extractJsonLd } from './extract/jsonld.js'
import { extractPageScan } from './extract/pageScan.js'
import { rootElement } from './extract/patterns.js'
import { extractMeta } from './extract/meta.js'
import { extractSitemap } from './extract/sitemap.js'
import { extractTimeTags } from './extract/timeTags.js'
import { extractUrlSlug } from './extract/urlSlug.js'
import { extractLabelledPairs, extractVisibleText } from './extract/visibleText.js'
import { resolveCandidates, type ResolveOptions } from './resolve.js'

export type { DayFirstHint } from './parse/locale.js'
export type {
  Adapter,
  ArchiveEvent,
  ArchiveTimeline,
  Candidate,
  Confidence,
  Conflict,
  ConflictKind,
  DateClaim,
  DateResult,
  Env,
  Field,
  Mode,
  Precision,
} from './types.js'
export { parseDateString, toInstant } from './parse/normalize.js'
export type { ParsedDate, ParseOptions } from './parse/normalize.js'
export { checkPlausibility, isPlausible } from './parse/plausibility.js'
export { extractFeed } from './extract/feed.js'
export { extractHttpHeaders } from './extract/headers.js'
export { extractImagePath } from './extract/imagePath.js'
export { extractInlineState } from './extract/inlineState.js'
export { extractSitemap } from './extract/sitemap.js'
/**
 * Exported for callers who have a URL and no document — a search-results
 * annotator, a crawl frontier deciding what to prioritise, a link preview. It
 * is the one signal that costs no network and no parse, which makes "date this
 * URL for free, then decide whether fetching it is worth it" a strategy the
 * library can support rather than one every caller reimplements badly.
 */
export { extractUrlSlug } from './extract/urlSlug.js'
export { isSafeFetchTarget } from './extract/urlGuard.js'
export { resolveCandidates } from './resolve.js'
export type { ResolveOptions } from './resolve.js'
export { isStale, staleness, toInterval } from './staleness.js'
export type {
  IsStaleOptions,
  Staleness,
  StalenessBasis,
  StalenessOptions,
  StalenessReason,
} from './staleness.js'

/**
 * Options controlling extraction.
 *
 * Deliberately small. Each earns its place by changing a decision the library
 * cannot make correctly on its own: how hard to look, what the caller knows
 * about the locale, and how much guessing they are willing to accept.
 */
export type ExtractOptions = {
  /** How hard to look. Defaults to `'standard'`. */
  mode?: Mode
  /**
   * Override the DD/MM vs MM/DD heuristic. Useful when the caller knows the
   * publication's locale and the page does not declare it.
   */
  dayFirst?: DayFirstHint
  /**
   * Discard candidates below this tier. `'declared'` answers "what does the
   * site actually claim", with no inference at all.
   */
  minConfidence?: Confidence
}

/**
 * Synchronous, DOM-only extraction. Performs no network access whatsoever.
 *
 * This is the half that runs in an extension content script; the network-backed
 * half runs in the service worker. See docs/DESIGN.md §6.2.
 */
export function extractFromDocument(
  doc: Document,
  url: string,
  options: ExtractOptions = {},
): Candidate[] {
  const parsedUrl = safeUrl(url)
  const mode = options.mode ?? 'standard'

  const opts: ParseOptions = {
    // An explicit hint beats the heuristic: a caller who knows the locale knows
    // it better than a guess from `lang` and the TLD.
    dayFirst:
      options.dayFirst ??
      detectDayFirst(rootElement(doc)?.getAttribute('lang'), parsedUrl?.hostname),
  }

  const candidates: Candidate[] = [
    ...safely(() => extractJsonLd(doc, opts)),
    ...safely(() => extractMeta(doc, opts)),
    ...safely(() => extractTimeTags(doc, opts)),
  ]

  if (parsedUrl) candidates.push(...safely(() => extractUrlSlug(parsedUrl)))

  // Also metadata, also free: the preview image the page declares often sits in
  // a dated upload directory. Weakest of the declared-metadata signals, so it
  // is collected here and ranked last rather than being gated behind a mode.
  candidates.push(...safely(() => extractImagePath(doc)))

  // Text scanning is around 80% of extraction cost, and `fast` exists to skip
  // it. Most pages carry metadata, so this still answers most of them.
  if (mode !== 'fast') {
    // The state a page hands its own JavaScript. Grouped with text scanning
    // rather than with the metadata above because, like text, it means reading
    // content the page never published as metadata — and pages that need it are
    // exactly the ones with no metadata to read.
    candidates.push(...safely(() => extractInlineState(doc, opts)))
    candidates.push(...safely(() => extractVisibleText(doc, parsedUrl, opts)))
    // A field name in one element labelling a date in the next. Structurally
    // anchored rather than adjacency-anchored, so it reaches the metadata panels
    // that `extractVisibleText` cannot see — including ones the furniture rules
    // exclude, which is safe only because the label is explicit. See the note on
    // `extractLabelledPairs`.
    candidates.push(...safely(() => extractLabelledPairs(doc, parsedUrl, opts)))

    // Unlabelled text is the noisiest signal, so by default it runs only when
    // the labelled paths found nothing to say.
    //
    // Running it unconditionally was tried and measured: it gained nothing on
    // the external corpus and turned a correct "no date here" into a false
    // positive locally. `extensive` opts into that trade knowingly.
    const nothingLabelled = !candidates.some((c) => c.field !== 'unknown')
    if (mode === 'extensive' || nothingLabelled) {
      candidates.push(...safely(() => extractBareText(doc, parsedUrl, opts)))
    }

    // Genuinely last: only in `extensive`, and only when everything above came
    // back with nothing at all. See {@link extractPageScan} — it asks nothing
    // about where a date sits, so it is the one extractor here that can answer a
    // page with no date furniture of any kind, and equally the one that will
    // answer a page that has no date to give.
    if (mode === 'extensive' && candidates.length === 0) {
      candidates.push(...safely(() => extractPageScan(doc, opts)))
    }
  }

  // A listing's body is other documents' metadata, so the extractors that read
  // the body are reading someone else's date. Applied here rather than inside
  // each extractor so the rule is stated once, and after collection so the
  // `nothingLabelled` gate above still sees what the page really contains.
  // `safely` for the same reason every extractor above uses it: this walks the
  // DOM, and a document nested deeper than the parser can recurse throws a
  // RangeError out of `querySelectorAll`. Failing closed here means "not an
  // index", which suppresses nothing — the conservative direction, since a
  // wrong suppression deletes a correct answer invisibly.
  const looksLikeIndex = safely(() => (isIndexPage(doc, parsedUrl) ? [true] : [])).length > 0
  const filtered = looksLikeIndex
    ? candidates.filter((c) => !isBodyScraped(c.source))
    : candidates

  return options.minConfidence
    ? filtered.filter((c) => atLeast(c.confidence, options.minConfidence!))
    : filtered
}

/**
 * Run one extractor, and let it fail alone.
 *
 * The input to this library is, by definition, whatever the open web hands it,
 * and a DOM implementation is entitled to give up on markup a page can trivially
 * construct: `node-html-parser` recurses per level in `findOne`, so roughly 8000
 * nested elements — 88 KB of `<div>` — overflows the stack inside the first
 * `querySelectorAll`. That threw straight out through `findDates` and killed the
 * process, which is a poor trade for one signal on one page.
 *
 * Catching per extractor rather than around the whole set is deliberate: a
 * document that defeats the text scanner can still have perfectly good JSON-LD,
 * and returning that beats returning nothing. It also does not care *which*
 * parser bug it is standing in front of, which is the point — the next one will
 * be different.
 */
function safely<T>(extract: () => T[]): T[] {
  try {
    return extract()
  } catch {
    return []
  }
}

/** Null-prototype for the same reason as the ranking tables in `resolve.ts`. */
const CONFIDENCE_ORDER: Record<Confidence, number> = Object.assign(Object.create(null), {
  declared: 3,
  derived: 2,
  inferred: 1,
})

const atLeast = (actual: Confidence, floor: Confidence): boolean =>
  (CONFIDENCE_ORDER[actual] ?? 0) >= (CONFIDENCE_ORDER[floor] ?? 0)

/**
 * Rank DOM candidates into a result.
 *
 * This is the half that runs in an extension service worker. Despite taking an
 * `Env`, it fetches nothing itself — the network-backed signals are collected by
 * {@link findDates}, and the archive timeline is passed in through
 * {@link ResolveOptions.archiveLastEdit} by the caller that fetched it.
 */
export async function resolve(
  candidates: Candidate[],
  url: string,
  env: Env = {},
  options: ResolveOptions = {},
): Promise<DateResult> {
  const resolveOptions: ResolveOptions = { ...options }
  if (!resolveOptions.now && env.now) resolveOptions.now = env.now()

  return resolveCandidates(candidates, resolveOptions)
}

/**
 * Which network-backed signals to collect. Each one costs at least a request,
 * so each is a decision rather than a default.
 */
export type NetworkOptions = {
  /**
   * Look the page up in the site's sitemap and read its `<lastmod>`.
   *
   * On by default, but skipped when the page already declares a modification
   * date — that is the only field a sitemap can speak to, and a site that
   * already stated it does not need to be asked twice.
   */
  sitemap?: boolean
  /**
   * Read `Last-Modified` from the response headers.
   *
   * Off by default. Behind a CDN this is the moment the response was built, and
   * measured on our fixtures it invents edits more often than it reports them
   * — see {@link extractHttpHeaders} and docs/DESIGN.md §4.10.
   */
  httpHeaders?: boolean
}

/**
 * Extract, augment with network signals, then resolve.
 *
 * `doc` is needed beyond extraction because feed and sitemap discovery read the
 * page's own `<link rel="alternate">`, `<link rel="sitemap">` and
 * `<link rel="canonical">`.
 */
export async function findDates(
  doc: Document,
  url: string,
  env: Env = {},
  options: ResolveOptions & ExtractOptions & NetworkOptions = {},
): Promise<DateResult> {
  const candidates = extractFromDocument(doc, url, options)
  const parsedUrl = safeUrl(url)
  const admits = (confidence: Confidence): boolean =>
    !options.minConfidence || atLeast(confidence, options.minConfidence)

  if (parsedUrl && env.fetchText) {
    const opts: ParseOptions = {
      dayFirst:
        options.dayFirst ??
        detectDayFirst(rootElement(doc)?.getAttribute('lang'), parsedUrl.hostname),
    }
    // Same reasoning as `safely` above, one layer out: these parse XML fetched
    // from a URL the *page* chose, so a hostile document gets to pick what the
    // XML parser is asked to survive.
    candidates.push(...(await extractFeed(doc, parsedUrl, env, opts).catch(() => [])))

    // A sitemap can only ever yield a `derived` candidate, so under a
    // `declared` floor the request would be made for an answer already refused.
    if (options.sitemap !== false && admits('derived') && !declaresModified(candidates)) {
      candidates.push(...(await extractSitemap(doc, parsedUrl, env, opts).catch(() => [])))
    }
  }

  if (options.httpHeaders && env.fetchHeaders && admits('inferred')) {
    // `async` so that an `Env` whose `fetchHeaders` throws synchronously is
    // contained like one that rejects.
    const headers = await (async () => env.fetchHeaders!(url))().catch(() => null)
    if (headers) {
      candidates.push(
        ...safely(() => extractHttpHeaders(headers, options.now ?? env.now?.() ?? new Date())),
      )
    }
  }

  // The floor again, over the network signals. `extractFromDocument` applied it
  // to what the page holds; a feed, sitemap or header arrives after that and
  // would otherwise walk straight past a caller who asked for declared dates only.
  return resolve(candidates.filter((c) => admits(c.confidence)), url, env, options)
}

const declaresModified = (candidates: Candidate[]): boolean =>
  candidates.some((c) => c.field === 'modified' && c.confidence === 'declared')

function safeUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}
