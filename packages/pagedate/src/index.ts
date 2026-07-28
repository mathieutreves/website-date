import type { Candidate, DateResult, Env } from './types.js'
import type { ParseOptions } from './parse/normalize.js'
import { detectDayFirst } from './parse/locale.js'
import { extractBareText } from './extract/bareText.js'
import { extractFeed } from './extract/feed.js'
import { extractJsonLd } from './extract/jsonld.js'
import { extractMeta } from './extract/meta.js'
import { extractTimeTags } from './extract/timeTags.js'
import { extractUrlSlug } from './extract/urlSlug.js'
import { extractVisibleText } from './extract/visibleText.js'
import { resolveCandidates, type ResolveOptions } from './resolve.js'

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
  Precision,
} from './types.js'
export { parseDateString, toInstant } from './parse/normalize.js'
export type { ParsedDate, ParseOptions } from './parse/normalize.js'
export { checkPlausibility, isPlausible } from './parse/plausibility.js'
export { extractFeed } from './extract/feed.js'
export { resolveCandidates } from './resolve.js'
export type { ResolveOptions } from './resolve.js'

/**
 * Synchronous, DOM-only extraction. Performs no network access whatsoever.
 *
 * This is the half that runs in an extension content script; the network-backed
 * half runs in the service worker. See docs/DESIGN.md §6.2.
 */
export function extractFromDocument(doc: Document, url: string): Candidate[] {
  const parsedUrl = safeUrl(url)

  const opts: ParseOptions = {
    dayFirst: detectDayFirst(doc.documentElement?.getAttribute('lang'), parsedUrl?.hostname),
  }

  const candidates: Candidate[] = [
    ...extractJsonLd(doc, opts),
    ...extractMeta(doc, opts),
    ...extractTimeTags(doc, opts),
    ...extractVisibleText(doc, parsedUrl, opts),
  ]

  if (parsedUrl) candidates.push(...extractUrlSlug(parsedUrl))

  // Last, and only as a fallback: unlabelled text dates are the noisiest
  // signal, so they run only when the labelled paths found nothing to say.
  //
  // Running them unconditionally was tried and measured: it gained nothing on
  // the external corpus and turned a correct "no date here" into a false
  // positive locally. The gate stays.
  if (!candidates.some((c) => c.field !== 'unknown')) {
    candidates.push(...extractBareText(doc, parsedUrl, opts))
  }

  return candidates
}

/**
 * Rank DOM candidates into a result, augmenting them with network-backed
 * signals when `env` provides the means to fetch.
 *
 * This is the half that runs in an extension service worker. Sitemap,
 * `Last-Modified` and the archive timeline are not wired in yet.
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
 * Extract, augment with network signals, then resolve.
 *
 * `doc` is needed beyond extraction because feed discovery reads the page's own
 * `<link rel="alternate">` and `<link rel="canonical">`.
 */
export async function findDates(
  doc: Document,
  url: string,
  env: Env = {},
  options: ResolveOptions = {},
): Promise<DateResult> {
  const candidates = extractFromDocument(doc, url)
  const parsedUrl = safeUrl(url)

  if (parsedUrl && env.fetchText) {
    const opts: ParseOptions = {
      dayFirst: detectDayFirst(doc.documentElement?.getAttribute('lang'), parsedUrl.hostname),
    }
    candidates.push(...(await extractFeed(doc, parsedUrl, env, opts)))
  }

  return resolve(candidates, url, env, options)
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}
