import type { Candidate, Confidence, DateResult, Env, Mode } from './types.js'
import type { DayFirstHint } from './parse/locale.js'

import type { ParseOptions } from './parse/normalize.js'
import { detectDayFirst } from './parse/locale.js'
import { extractBareText } from './extract/bareText.js'
import { extractFeed } from './extract/feed.js'
import { extractHttpHeaders } from './extract/headers.js'
import { extractJsonLd } from './extract/jsonld.js'
import { extractMeta } from './extract/meta.js'
import { extractSitemap } from './extract/sitemap.js'
import { extractTimeTags } from './extract/timeTags.js'
import { extractUrlSlug } from './extract/urlSlug.js'
import { extractVisibleText } from './extract/visibleText.js'
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
export { extractSitemap } from './extract/sitemap.js'
export { resolveCandidates } from './resolve.js'
export type { ResolveOptions } from './resolve.js'

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
      detectDayFirst(doc.documentElement?.getAttribute('lang'), parsedUrl?.hostname),
  }

  const candidates: Candidate[] = [
    ...extractJsonLd(doc, opts),
    ...extractMeta(doc, opts),
    ...extractTimeTags(doc, opts),
  ]

  if (parsedUrl) candidates.push(...extractUrlSlug(parsedUrl))

  // Text scanning is around 80% of extraction cost, and `fast` exists to skip
  // it. Most pages carry metadata, so this still answers most of them.
  if (mode !== 'fast') {
    candidates.push(...extractVisibleText(doc, parsedUrl, opts))

    // Unlabelled text is the noisiest signal, so by default it runs only when
    // the labelled paths found nothing to say.
    //
    // Running it unconditionally was tried and measured: it gained nothing on
    // the external corpus and turned a correct "no date here" into a false
    // positive locally. `extensive` opts into that trade knowingly.
    const nothingLabelled = !candidates.some((c) => c.field !== 'unknown')
    if (mode === 'extensive' || nothingLabelled) {
      candidates.push(...extractBareText(doc, parsedUrl, opts))
    }
  }

  return options.minConfidence
    ? candidates.filter((c) => atLeast(c.confidence, options.minConfidence!))
    : candidates
}

const CONFIDENCE_ORDER: Record<Confidence, number> = { declared: 3, derived: 2, inferred: 1 }

const atLeast = (actual: Confidence, floor: Confidence): boolean =>
  CONFIDENCE_ORDER[actual] >= CONFIDENCE_ORDER[floor]

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

  if (parsedUrl && env.fetchText) {
    const opts: ParseOptions = {
      dayFirst:
        options.dayFirst ??
        detectDayFirst(doc.documentElement?.getAttribute('lang'), parsedUrl.hostname),
    }
    candidates.push(...(await extractFeed(doc, parsedUrl, env, opts)))

    if (options.sitemap !== false && !declaresModified(candidates)) {
      candidates.push(...(await extractSitemap(doc, parsedUrl, env, opts)))
    }
  }

  if (options.httpHeaders && env.fetchHeaders) {
    const headers = await env.fetchHeaders(url).catch(() => null)
    if (headers) {
      candidates.push(...extractHttpHeaders(headers, options.now ?? env.now?.() ?? new Date()))
    }
  }

  return resolve(candidates, url, env, options)
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
