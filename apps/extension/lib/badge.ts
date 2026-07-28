import { toInstant, type DateResult } from 'pagedate'

/**
 * What the toolbar icon says when "check every page automatically" is on.
 *
 * A badge is four characters at 9px. It cannot carry provenance, so it does not
 * try: it reports age, and it reports *that* a contradiction exists without
 * pretending to explain it. The popup is where the explanation lives, and the
 * badge's job is to tell you when to open it.
 *
 * Pure, so the thresholds are testable without a browser.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export type Badge = {
  text: string
  /** Background colour; the tier colour, or the alert colour on a conflict. */
  color: string
  /** Tooltip on the toolbar icon. */
  title: string
}

/** Deliberately not the popup's CSS variables: the badge has no stylesheet. */
const COLORS = {
  declared: '#0f766e',
  derived: '#c2410c',
  inferred: '#6b7280',
  alert: '#b3261e',
  unknown: '#4b5563',
} as const

export function compactAge(value: string, now: Date): string | null {
  const at = toInstant(value)
  if (!at) return null

  const days = (now.getTime() - at.getTime()) / DAY_MS
  if (days < -1) return '→'
  if (days < 30) return `${Math.max(1, Math.round(days))}d`
  if (days < 365) return `${Math.round(days / 30.44)}mo`
  return `${Math.round(days / 365.25)}y`
}

export function badgeFor(result: DateResult | null, now: Date): Badge {
  if (!result) return { text: '?', color: COLORS.unknown, title: 'No date found' }

  // A contradiction outranks the age. Showing "2mo" on a page that carries a
  // decade of older content would be the badge repeating the page's own claim
  // as though it were verified.
  if (result.conflict) {
    return {
      text: '!',
      color: COLORS.alert,
      title: result.conflict.detail,
    }
  }

  const primary = result.published ?? result.modified
  if (!primary) return { text: '?', color: COLORS.unknown, title: 'No date found' }

  const age = compactAge(primary.value, now)
  if (!age) return { text: '?', color: COLORS.unknown, title: 'No date found' }

  return {
    text: age,
    color: COLORS[primary.confidence],
    title: `${primary.value} — ${primary.confidence}, ${primary.source}`,
  }
}
