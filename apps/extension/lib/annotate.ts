import type { DateResult } from 'pagedate'
import { compactAge } from './badge.js'
import { display, sourceLabel, tierWord } from './format.js'
import { t } from './messages.js'
import type { DateFormat } from './settings.js'
import type { LinkDate, LinkTier } from './link-date.js'

/**
 * What a dated link says, and how much work it is allowed to cost.
 *
 * Pure, so the wording and the budget arithmetic are testable without a browser
 * or a search engine. The DOM half is `entrypoints/annotate.ts`.
 */

/**
 * How many links on one results page may be fetched.
 *
 * Ten because a results page shows about ten results, so the cap is "one screen,
 * once" rather than a number tuned to a benchmark. It matters more than it
 * looks: without it, an infinite-scroll results page would keep issuing
 * requests to third-party sites for as long as the reader kept scrolling, which
 * is not something anyone consented to by turning on an annotation setting.
 *
 * The URL tier is not capped, because it costs nothing and reaches nobody.
 */
export const MAX_FETCHES_PER_PAGE = 10

/** Concurrent fetches. Low: this is a background nicety, not the reader's task. */
export const FETCH_CONCURRENCY = 3

export type ChipTone = 'declared' | 'derived' | 'inferred' | 'alert'

export type Chip = {
  /** Four or five characters: `3y`, `2mo`, `!`. */
  text: string
  /** The full sentence, shown on hover. */
  title: string
  tone: ChipTone
}

/**
 * The chip for one dated link.
 *
 * Deliberately the same compact vocabulary as the toolbar badge — `3y`, `2mo` —
 * because a reader who has seen one has learned the other, and a second age
 * notation would be a second thing to learn for no gain.
 *
 * A URL-tier reading is always `inferred` regardless of what the resolver
 * decided. The resolver is ranking candidates within a document; here the only
 * evidence is that the address contains something date-shaped, and a chip that
 * presented that with the same weight as a declared JSON-LD date would be
 * overstating a guess. The tooltip says where it came from.
 */
export function chipFor(
  link: LinkDate,
  now: Date,
  dateFormat: DateFormat = 'relative',
): Chip | null {
  const { result, tier } = link

  if (result.conflict) {
    return { text: '!', tone: 'alert', title: t('conflictDisagreement') }
  }

  const primary = result.published ?? result.modified
  if (!primary) return null

  const text = compactAge(primary.value, now)
  if (!text) return null

  const exact = display(primary, dateFormat === 'iso' ? 'iso' : 'absolute')
  const provenance =
    tier === 'url'
      ? t('annotateFromUrl')
      : `${tierWord(primary.confidence)}, ${sourceLabel(primary.source)}`

  return {
    text,
    tone: tier === 'url' ? 'inferred' : primary.confidence,
    title: `${t(result.published ? 'fieldPublished' : 'fieldModified')}: ${exact} — ${provenance}`,
  }
}

/**
 * Should this link be fetched, given what the URL alone already said?
 *
 * Split out because it is the decision that spends someone's bandwidth and
 * reveals a reader's search results to a third-party site, and it should be
 * legible in one place rather than inlined into a loop.
 */
export function shouldFetch(
  url: string,
  fromUrlTier: LinkDate | null,
  spent: number,
  seen: Set<string>,
): boolean {
  if (fromUrlTier) return false
  if (spent >= MAX_FETCHES_PER_PAGE) return false
  if (seen.has(url)) return false
  return /^https?:/i.test(url)
}

/**
 * Run tasks `concurrency` at a time, in order, stopping early if asked.
 *
 * A pool rather than `Promise.all` because the whole point is to *not* issue
 * ten simultaneous requests to ten sites the moment a results page renders.
 */
export async function pooled<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      await run(items[index]!).catch(() => {})
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}

/** Shape handed to the injected renderer. Plain data: it crosses a clone boundary. */
export type Annotation = {
  /** Index into the link list the injector built, so the renderer needs no selector. */
  index: number
  chip: Chip
}

export type { DateResult, LinkTier }
