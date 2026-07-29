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
 *   3. With access, fetch the page in the *tab* — not the worker, which has no
 *      `DOMParser` — and read its metadata.
 */

export type MenuOutcome =
  | { kind: 'dated'; link: LinkDate }
  | { kind: 'none' }
  | { kind: 'unreachable' }
  | { kind: 'denied' }

export type MenuDeps = {
  /** Does the extension already hold access to this origin? */
  hasOrigin: (pattern: string) => Promise<boolean>
  /** Ask for it. Must be called while the click's user gesture is still live. */
  requestOrigin: (pattern: string) => Promise<boolean>
  /**
   * Fetch and extract, in a context that has a DOM — which means a tab, not the
   * service worker. Returns `null` when the page could not be read at all, and
   * an empty array when it was read and carries nothing; the two get different
   * answers, so they must not be collapsed.
   */
  readInTab: (url: string) => Promise<Candidate[] | null>
  now?: Date
}

export async function checkLink(url: string, deps: MenuDeps): Promise<MenuOutcome> {
  const now = deps.now ?? new Date()

  const fromUrl = dateFromUrl(url, now)
  if (fromUrl) return { kind: 'dated', link: fromUrl }

  const pattern = originPattern(url)
  if (!pattern) return { kind: 'none' }

  const allowed = (await deps.hasOrigin(pattern)) || (await deps.requestOrigin(pattern))
  if (!allowed) return { kind: 'denied' }

  const candidates = await deps.readInTab(url).catch(() => null)
  if (candidates === null) return { kind: 'unreachable' }

  const fetched = dateFromCandidates(url, candidates, now)
  return fetched ? { kind: 'dated', link: fetched } : { kind: 'none' }
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
