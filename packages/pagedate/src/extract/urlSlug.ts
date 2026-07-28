import type { Candidate } from '../types.js'
import { MONTH_NAME_PATTERN, monthFromName } from '../parse/locale.js'

/** e.g. `/2024/Dec/31/` — used by Django-style and several static-site blogs. */
const NAMED_MONTH_PATH = new RegExp(
  `(?:^|/)(\\d{4})/(${MONTH_NAME_PATTERN})/(\\d{1,2})(?:/|$)`,
  'i',
)

/**
 * Dates baked into the URL path, e.g. `/2024/03/12/some-post`.
 *
 * Weak by nature — the URL is fixed at creation and never reflects later edits
 * — but it survives on exactly the pages that carry no metadata at all, which
 * is where help is most needed.
 */
export function extractUrlSlug(url: URL): Candidate[] {
  const path = url.pathname

  const full = /(?:^|\/)(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[/-]|$)/.exec(path)
  if (full) {
    const candidate = build(Number(full[1]), Number(full[2]), Number(full[3]))
    if (candidate) return [candidate]
  }

  const named = NAMED_MONTH_PATH.exec(path)
  if (named) {
    const month = monthFromName(named[2]!)
    if (month !== undefined) {
      const candidate = build(Number(named[1]), month, Number(named[3]))
      if (candidate) return [candidate]
    }
  }

  const monthly = /(?:^|\/)(\d{4})\/(\d{1,2})(?:\/|$)/.exec(path)
  if (monthly) {
    const y = Number(monthly[1])
    const m = Number(monthly[2])
    if (isYear(y) && m >= 1 && m <= 12) {
      return [
        {
          value: `${y}-${String(m).padStart(2, '0')}`,
          precision: 'month',
          field: 'published',
          source: 'url-slug',
          confidence: 'inferred',
          note: `year and month in URL path`,
        },
      ]
    }
  }

  return []
}

function isYear(y: number): boolean {
  return y >= 1995 && y <= 2100
}

function build(y: number, m: number, d: number): Candidate | null {
  if (!isYear(y) || m < 1 || m > 12 || d < 1 || d > 31) return null

  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null

  return {
    value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    precision: 'day',
    field: 'published',
    source: 'url-slug',
    confidence: 'inferred',
    note: 'date in URL path',
  }
}
