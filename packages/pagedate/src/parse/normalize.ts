import type { Precision } from '../types.js'
import {
  type DayFirstHint,
  foldCase,
  MONTH_NAME_PATTERN,
  monthFromName,
  normaliseDigits,
  NOT_MID_WORD,
  ORDINAL_SUFFIX,
} from './locale.js'

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
  // Arabic, Persian and Indic pages render dates in their own digit systems;
  // without this a parser that only knows 0-9 sees no date at all.
  const input = normaliseDigits(raw.trim())
  if (!input) return null

  return (
    parseIso(input) ??
    parseCjk(input) ??
    parseRfc2822(input) ??
    parseNumeric(input, opts.dayFirst ?? 'unknown') ??
    parseTextualMonth(input)
  )
}

/**
 * CJK dates are structural rather than named: `2024年3月12日`, or `2024년 3월
 * 12일` in Korean. Japanese shares the Chinese markers.
 *
 * Year-month-day order makes these unambiguous, so no locale hint is needed.
 */
function parseCjk(input: string): ParsedDate | null {
  const full = /(\d{4})\s*[年년]\s*(\d{1,2})\s*[月월]\s*(\d{1,2})\s*[日일]?/.exec(input)
  if (full) {
    const parsed = ymd(Number(full[1]), Number(full[2]), Number(full[3]))
    if (parsed) return parsed
  }

  const monthOnly = /(\d{4})\s*[年년]\s*(\d{1,2})\s*[月월]/.exec(input)
  if (monthOnly) {
    const m = Number(monthOnly[2])
    if (m >= 1 && m <= 12) {
      return { value: `${monthOnly[1]}-${pad(m)}`, precision: 'month' }
    }
  }

  const yearOnly = /(\d{4})\s*[年년]/.exec(input)
  if (yearOnly) return { value: yearOnly[1]!, precision: 'year' }

  return null
}

/** ISO 8601 and its common near-misses, including the `YYYY-MM` / `YYYY` prefixes. */
function parseIso(input: string): ParsedDate | null {
  // Full timestamp — keep to minute precision; seconds add nothing for our purposes.
  // `t`/`z` in lowercase and an hour-only offset (`+05`) are all valid RFC 3339
  // or ISO 8601 and all turn up; read strictly, the first was rejected outright
  // and the second lost its zone and became a local time.
  const full =
    /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([Zz]|[+-]\d{2}(?::?\d{2})?(?!\d))?/.exec(
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
    const suffix = !zone
      ? ''
      : zone === 'Z' || zone === 'z'
        ? 'Z'
        : zone.replace(/^([+-]\d{2}):?(\d{2})?$/, (_m, h: string, m?: string) => `${h}:${m ?? '00'}`)
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

  // Year-first with a non-ISO separator, e.g. `2024/03/12` or `2015.4.23` —
  // unambiguous because the 4-digit year comes first, so there is no
  // day-versus-month guess to make.
  //
  // The separator is backreferenced rather than matched twice independently:
  // `2015/4.23` is not a form anyone writes, and accepting it would let two
  // unrelated numbers either side of a full stop parse as a date.
  //
  // A clock time may follow — `2024/03/12 10:00` is the ordinary Japanese
  // timestamp — and is dropped: it names no zone, so the day is what it says.
  const yearFirst = /^(\d{4})([/.])(\d{1,2})\2(\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(input)
  if (yearFirst) return ymd(Number(yearFirst[1]), Number(yearFirst[3]), Number(yearFirst[4]))

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
 * available, this deliberately degrades to year precision rather than guessing
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
  // month (a === b) the day is knowable, otherwise only the year is.
  if (a === b) return ymd(y, a, b)
  return { value: `${pad(y, 4)}`, precision: 'year' }
}

/*
 * Built once, at module load.
 *
 * `MONTH_NAME_PATTERN` is a 333-alternative, 2.4 KB alternation, and compiling
 * the three patterns below costs ~46 µs. They are loop-invariant, so doing it
 * per call put that on the hot path of every date parsed from text.
 */

/**
 * "12 March 2024", "12 marzo 2024", "12 de marzo de 2024", "12th of March 2024",
 * and the German ordinal form "19. Juli 2014" — the dot after the day is an
 * ordinal marker, not a separator.
 *
 * The day carries an ordinal suffix and the connector accepts `of` as well as
 * `de`, and both matter for the same reason. Without them "12th of March 2024"
 * fails here, falls through to {@link MONTH_YEAR_TEXTUAL}, and is reported as
 * `2024-03` — a day the page stated in plain English, dropped, and returned at a
 * precision the page never used. This regex is the parser and
 * `extract/patterns.ts` is the finder; a form has to be in both, which is
 * exactly the trap this pair fell into.
 */
const DAY_FIRST_TEXTUAL = new RegExp(
  `(?<![A-Za-z0-9_])(\\d{1,2})${ORDINAL_SUFFIX}\\.?\\s+(?:de\\s+|of\\s+)?(${MONTH_NAME_PATTERN})\\.?\\s+(?:de\\s+|del\\s+)?(\\d{4})\\b`,
  'i',
)

/**
 * "March 12 2024".
 *
 * Opens with {@link NOT_MID_WORD} rather than `\\b`, which without the `u` flag
 * is an ASCII notion: there is no `\\b` in front of a Cyrillic, Greek, Arabic or
 * Devanagari letter, so "Март 2024" and "مارس 2024" never matched at all. The
 * day-first form survived only because its boundary sits before a digit.
 */
const MONTH_FIRST_TEXTUAL = new RegExp(
  `${NOT_MID_WORD}(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{1,2})\\s+(\\d{4})\\b`,
  'i',
)

/** "March 2024" — month precision, no day was stated. */
const MONTH_YEAR_TEXTUAL = new RegExp(`${NOT_MID_WORD}(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{4})\\b`, 'i')

/** Dates written with a month name, in either order and in any supported language. */
function parseTextualMonth(input: string): ParsedDate | null {
  // Fold before matching: MONTH_NAME_PATTERN is built from diacritic-stripped
  // keys, so `février` only matches once the input is folded too.
  // Ordinal suffixes are dropped rather than matched around, so every language's
  // form collapses to a plain number and the three patterns below stay readable.
  // `°`/`º`/`ª` need no `\b` after them — they are not word characters, and a
  // word boundary there would never match.
  const cleaned = foldCase(input)
    .replace(/(\d+)(?:st|nd|rd|th|ers?|ere|eme|e)\b/gi, '$1')
    .replace(/(\d+)[º°ª]/g, '$1')
    .replace(/,/g, ' ')

  const dayFirst = DAY_FIRST_TEXTUAL.exec(cleaned)
  if (dayFirst) {
    const month = monthFromName(dayFirst[2]!)
    if (month !== undefined) return ymd(Number(dayFirst[3]), month, Number(dayFirst[1]))
  }

  const monthFirst = MONTH_FIRST_TEXTUAL.exec(cleaned)
  if (monthFirst) {
    const month = monthFromName(monthFirst[1]!)
    if (month !== undefined) return ymd(Number(monthFirst[3]), month, Number(monthFirst[2]))
  }

  const monthYear = MONTH_YEAR_TEXTUAL.exec(cleaned)
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
 *
 * A timestamp with no zone is read as UTC. `new Date('2024-03-12T10:00')` is
 * local time, so left to the platform the same candidate named three different
 * instants in Los Angeles, London and Auckland — and which of two declared dates
 * ranked earlier, whether a date counted as in the future, and how stale a page
 * was all depended on where the code happened to run.
 *
 * Returns `null` for a value that names no real date. `Date` rolls `2024-02-30`
 * over to March rather than refusing it, and the extractors never emit one, but
 * `resolveCandidates` is exported and a caller-built candidate reaches here
 * unvalidated.
 */
export function toInstant(value: string): Date | null {
  const partial = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value)
  if (partial) {
    const y = Number(partial[1])
    const m = Number(partial[2] ?? 1)
    const d = Number(partial[3] ?? 1)
    return isValidYmd(y, m, d) ? new Date(Date.UTC(y, m - 1, d)) : null
  }

  const day = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value)
  if (day && !isValidYmd(Number(day[1]), Number(day[2]), Number(day[3]))) return null

  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
  const parsed = new Date(day && !zoned ? `${value}Z` : value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
