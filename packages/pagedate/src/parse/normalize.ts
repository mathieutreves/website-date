import type { Precision } from '../types.js'
import { type DayFirstHint, foldCase, MONTH_NAME_PATTERN, monthFromName } from './locale.js'

export type ParsedDate = {
  /** ISO 8601 truncated to `precision`. */
  value: string
  precision: Precision
}

export type ParseOptions = {
  /** Disambiguates all-numeric dates like `03/04/2024`. */
  dayFirst?: DayFirstHint
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** Reject structurally impossible dates before they reach plausibility checks. */
function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  // Date rolls over invalid days (Feb 30 → Mar 2), so round-trip to detect it.
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

function ymd(y: number, m: number, d: number): ParsedDate | null {
  if (!isValidYmd(y, m, d)) return null
  return { value: `${pad(y, 4)}-${pad(m)}-${pad(d)}`, precision: 'day' }
}

/**
 * Parse an arbitrary date string into ISO 8601 plus the precision the source
 * actually carried.
 *
 * Precision is never inflated: `"2024"` yields `{ value: '2024', precision:
 * 'year' }`, not a fabricated January 1st. Downstream ranking uses precision to
 * prefer sharper sources, so inventing it would corrupt resolution.
 *
 * Returns `null` for anything unrecognised or structurally invalid.
 */
export function parseDateString(raw: string, opts: ParseOptions = {}): ParsedDate | null {
  const input = raw.trim()
  if (!input) return null

  return (
    parseIso(input) ??
    parseRfc2822(input) ??
    parseNumeric(input, opts.dayFirst ?? 'unknown') ??
    parseTextualMonth(input)
  )
}

/** ISO 8601 and its common near-misses, including the `YYYY-MM` / `YYYY` prefixes. */
function parseIso(input: string): ParsedDate | null {
  // Full timestamp — keep to minute precision; seconds add nothing for our purposes.
  const full = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(
    input,
  )
  if (full) {
    const [, ys, ms, ds, hs, mins, zone] = full
    const y = Number(ys)
    const m = Number(ms)
    const d = Number(ds)
    if (!isValidYmd(y, m, d)) return null
    const h = Number(hs)
    const mi = Number(mins)
    if (h > 23 || mi > 59) return null
    // Timezone is preserved verbatim rather than normalised to UTC — converting
    // shifts the displayed day for no benefit. See docs/DESIGN.md §4.7.
    const suffix = zone ? (zone === 'Z' ? 'Z' : zone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : ''
    return {
      value: `${pad(y, 4)}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}${suffix}`,
      precision: 'minute',
    }
  }

  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input)
  if (dayOnly) return ymd(Number(dayOnly[1]), Number(dayOnly[2]), Number(dayOnly[3]))

  const monthOnly = /^(\d{4})-(\d{2})$/.exec(input)
  if (monthOnly) {
    const m = Number(monthOnly[2])
    if (m < 1 || m > 12) return null
    return { value: `${monthOnly[1]}-${pad(m)}`, precision: 'month' }
  }

  const yearOnly = /^(\d{4})$/.exec(input)
  if (yearOnly) return { value: yearOnly[1]!, precision: 'year' }

  // Slash-separated ISO order, e.g. `2024/03/12` — unambiguous because the
  // 4-digit year comes first.
  const slashIso = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(input)
  if (slashIso) return ymd(Number(slashIso[1]), Number(slashIso[2]), Number(slashIso[3]))

  return null
}

/** RFC 2822, as emitted by RSS `<pubDate>`. */
function parseRfc2822(input: string): ParsedDate | null {
  const match =
    /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:\s+(\d{2}):(\d{2})(?::\d{2})?\s*(GMT|UTC|Z|[+-]\d{4}))?/.exec(
      input,
    )
  if (!match) return null

  const [, ds, monthName, ys, hs, mins, zone] = match
  const month = monthFromName(monthName!)
  if (month === undefined) return null

  const y = Number(ys)
  const d = Number(ds)
  if (!isValidYmd(y, month, d)) return null

  if (hs === undefined || mins === undefined) return ymd(y, month, d)

  const h = Number(hs)
  const mi = Number(mins)
  if (h > 23 || mi > 59) return null

  let suffix = ''
  if (zone) {
    suffix =
      zone === 'GMT' || zone === 'UTC' || zone === 'Z'
        ? 'Z'
        : zone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')
  }

  return {
    value: `${pad(y, 4)}-${pad(month)}-${pad(d)}T${pad(h)}:${pad(mi)}${suffix}`,
    precision: 'minute',
  }
}

/**
 * All-numeric dates with the year last: `12/03/2024`, `12.03.2024`, `12-03-2024`.
 *
 * When the two leading components can't be told apart and no locale hint is
 * available, this deliberately degrades to month precision rather than guessing
 * — a wrong guess here produces a confidently wrong date, which is worse than a
 * vague one.
 */
function parseNumeric(input: string, dayFirst: DayFirstHint): ParsedDate | null {
  const match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(input)
  if (!match) return null

  const a = Number(match[1])
  const b = Number(match[2])
  const y = Number(match[3])

  // One of the two can only be a day, which settles it regardless of locale.
  if (a > 12 && b <= 12) return ymd(y, b, a)
  if (b > 12 && a <= 12) return ymd(y, a, b)
  if (a > 12 && b > 12) return null

  if (dayFirst === 'day-first') return ymd(y, b, a)
  if (dayFirst === 'month-first') return ymd(y, a, b)

  // Genuinely ambiguous. Both readings share the year; if they also share the
  // month (a === b) the day is knowable, otherwise drop to month precision.
  if (a === b) return ymd(y, a, b)
  return { value: `${pad(y, 4)}`, precision: 'year' }
}

/** Dates written with a month name, in either order and in any supported language. */
function parseTextualMonth(input: string): ParsedDate | null {
  // Fold before matching: MONTH_NAME_PATTERN is built from diacritic-stripped
  // keys, so `février` only matches once the input is folded too.
  const cleaned = foldCase(input)
    .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1')
    .replace(/,/g, ' ')

  // "12 March 2024", "12 marzo 2024", "12 de marzo de 2024", and the German
  // ordinal form "19. Juli 2014" — the dot after the day is an ordinal marker,
  // not a separator.
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})\\.?\\s+(?:de\\s+)?(${MONTH_NAME_PATTERN})\\.?\\s+(?:de\\s+|del\\s+)?(\\d{4})\\b`,
    'i',
  ).exec(cleaned)
  if (dayFirst) {
    const month = monthFromName(dayFirst[2]!)
    if (month !== undefined) return ymd(Number(dayFirst[3]), month, Number(dayFirst[1]))
  }

  // "March 12 2024"
  const monthFirst = new RegExp(
    `\\b(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{1,2})\\s+(\\d{4})\\b`,
    'i',
  ).exec(cleaned)
  if (monthFirst) {
    const month = monthFromName(monthFirst[1]!)
    if (month !== undefined) return ymd(Number(monthFirst[3]), month, Number(monthFirst[2]))
  }

  // "March 2024" — month precision, no day was stated.
  const monthYear = new RegExp(`\\b(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{4})\\b`, 'i').exec(cleaned)
  if (monthYear) {
    const month = monthFromName(monthYear[1]!)
    if (month !== undefined) {
      return { value: `${monthYear[2]}-${pad(month)}`, precision: 'month' }
    }
  }

  return null
}

/**
 * Instant a candidate refers to, for comparison and gap arithmetic.
 * Partial values resolve to the start of their period.
 */
export function toInstant(value: string): Date | null {
  if (/^\d{4}$/.test(value)) return new Date(`${value}-01-01T00:00:00Z`)
  if (/^\d{4}-\d{2}$/.test(value)) return new Date(`${value}-01T00:00:00Z`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
