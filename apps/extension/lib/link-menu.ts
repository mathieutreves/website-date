import type { Candidate } from 'pagedate'
import { chipFor } from './annotate.js'
import { dateFromCandidates, dateFromUrl, originPattern, type LinkDate } from './link-date.js'
import { display, sourceLabel, tierWord } from './format.js'
import { t } from './messages.js'
import type { DateFormat } from './settings.js'

/**
 * "When was this page written?" on a link, without opening it.
 *
 * The smallest useful version of the search-results feature, and the one that
 * needs no standing permission at all. Right-clicking a link is an
 * unambiguous request about *that* link, so the extension can do the thing this
 * codebase otherwise refuses to do — touch a site the reader has not visited —
 * because the click is the consent and its scope is one page.
 *
 * The sequence is cheapest-first and stops as soon as it can:
 *
 *   1. Read the address. A dated permalink answers immediately, with no request
 *      and no prompt. On blogs and news this is most links.
 *   2. Otherwise ask for access to that one origin, at that moment. Declining
 *      leaves the reader exactly where they were.
 *   3. With access, fetch the page in the worker — whose requests the grant
 *      covers — and parse it in the *tab*, which has the `DOMParser` the worker
 *      lacks.
 *   4. Hand the access back. It was asked for to answer one question.
 */

export type MenuOutcome =
  | { kind: 'dated'; link: LinkDate }
  | { kind: 'none' }
  | { kind: 'unreachable' }
  | { kind: 'denied' }

export type MenuDeps = {
  /**
   * Did the extension hold access to this origin *before* the click? Decides
   * whether the access is ours to give back afterwards.
   */
  hasOrigin: (pattern: string) => Promise<boolean>
  /**
   * Ask for it. Resolves `true` at once, with no prompt, when it is already
   * held — so it is called unconditionally, and must be the first thing
   * awaited: see {@link checkLink}.
   */
  requestOrigin: (pattern: string) => Promise<boolean>
  /** Give back access this click asked for. */
  releaseOrigin: (pattern: string) => Promise<unknown>
  /**
   * Fetch and extract. Returns `null` when the page could not be read at all,
   * and an empty array when it was read and carries nothing; the two get
   * different answers, so they must not be collapsed.
   */
  readPage: (url: string) => Promise<Candidate[] | null>
  /** The slow path has started: there is a request in flight and up to eight seconds to wait. */
  onReading?: () => void
  now?: Date
}

/**
 * Must be *called* synchronously from the click handler, and awaits nothing
 * before `requestOrigin`.
 *
 * A permission prompt is only allowed while the click's user gesture is live,
 * and Firefox considers it spent at the first `await` — so the earlier shape of
 * this, which awaited a settings read and then a `contains` before asking,
 * had its request rejected there every time. The `contains` still happens,
 * because the answer decides whether the grant is handed back; it is *started*
 * before the request and awaited after it.
 */
export async function checkLink(url: string, deps: MenuDeps): Promise<MenuOutcome> {
  const now = deps.now ?? new Date()

  const fromUrl = dateFromUrl(url, now)
  if (fromUrl) return { kind: 'dated', link: fromUrl }

  const pattern = originPattern(url)
  if (!pattern) return { kind: 'none' }

  // A check that fails is treated as "already held": the one mistake not to
  // make is removing a grant that a setting owns.
  const held = deps.hasOrigin(pattern).catch(() => true)
  const allowed = await deps.requestOrigin(pattern).catch(() => false)

  try {
    if (!allowed) return { kind: 'denied' }

    deps.onReading?.()
    const candidates = await deps.readPage(url).catch(() => null)
    if (candidates === null) return { kind: 'unreachable' }

    const fetched = dateFromCandidates(url, candidates, now)
    return fetched ? { kind: 'dated', link: fetched } : { kind: 'none' }
  } finally {
    /*
     * The grant was for this question, so it ends with it — unless it was there
     * before the click, in which case it belongs to a setting and is not this
     * function's to remove. `pattern` is always one concrete scheme and host,
     * so it can never name the all-sites grant or a search-engine one; the
     * `held` check is what covers the case where one of those already spans it.
     */
    if (!(await held)) await Promise.resolve(deps.releaseOrigin(pattern)).catch(() => {})
  }
}

export type Toast = {
  heading: string
  detail: string
  tone: 'declared' | 'derived' | 'inferred' | 'alert' | 'muted'
}

/**
 * The outcome as two lines of text.
 *
 * Pure and separate from the injection so the wording — which is the whole
 * product here — is testable. Every failure is phrased as a statement about
 * what this tool could not learn, never as one about the page: "could not read
 * that page" and "that page has no date" are different claims, and only one of
 * them is ours to make.
 */
/** Shown while the page is being fetched, and replaced by the answer. */
export const checkingToast = (host: string): Toast => ({
  heading: t('menuChecking'),
  detail: t('menuResultFor', host),
  tone: 'muted',
})

export function toastFor(
  outcome: MenuOutcome,
  host: string,
  now: Date,
  dateFormat: DateFormat = 'relative',
): Toast {
  switch (outcome.kind) {
    case 'none':
      return { heading: t('menuNoDate'), detail: t('menuResultFor', host), tone: 'muted' }
    case 'unreachable':
      return { heading: t('menuUnreachable'), detail: t('menuResultFor', host), tone: 'muted' }
    case 'denied':
      return { heading: t('menuNeedsPermission'), detail: t('menuResultFor', host), tone: 'muted' }
    case 'dated': {
      const chip = chipFor(outcome.link, now, dateFormat)
      const primary = outcome.link.result.published ?? outcome.link.result.modified

      if (!primary || !chip) {
        return { heading: t('menuNoDate'), detail: t('menuResultFor', host), tone: 'muted' }
      }

      const provenance =
        outcome.link.tier === 'url'
          ? t('annotateFromUrl')
          : `${tierWord(primary.confidence)}, ${sourceLabel(primary.source)}`

      return {
        heading: `${t(outcome.link.result.published ? 'fieldPublished' : 'fieldModified')}: ${display(primary, dateFormat === 'iso' ? 'iso' : 'absolute')}`,
        detail: `${host} — ${provenance}`,
        tone: chip.tone,
      }
    }
  }
}

/** Convenience for the worker, which has the URL rather than the host. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
