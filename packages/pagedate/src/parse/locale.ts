/**
 * Month-name tables and the DD/MM-vs-MM/DD disambiguation hint.
 *
 * Only the US (plus a short tail of others) writes month-first. Since the
 * corpus deliberately includes Italian sites, guessing wrong here silently
 * corrupts dates rather than failing loudly — so when we can't tell, we drop
 * precision instead of picking. See docs/DESIGN.md §4.7.
 */

/** Which component comes first in an all-numeric date like `03/04/2024`. */
export type DayFirstHint = 'day-first' | 'month-first' | 'unknown'

/** Locales that write month-first. Everything else is day-first. */
const MONTH_FIRST_LANGS = new Set(['en-us'])
const MONTH_FIRST_TLDS = new Set(['us'])

/**
 * Month names and abbreviations, normalised to lowercase without diacritics.
 * Value is the 1-indexed month.
 */
const MONTHS: Record<string, number> = {}

function register(month: number, ...names: string[]): void {
  for (const name of names) MONTHS[name] = month
}

// English
register(1, 'january', 'jan')
register(2, 'february', 'feb')
register(3, 'march', 'mar')
register(4, 'april', 'apr')
register(5, 'may')
register(6, 'june', 'jun')
register(7, 'july', 'jul')
register(8, 'august', 'aug')
register(9, 'september', 'sep', 'sept')
register(10, 'october', 'oct')
register(11, 'november', 'nov')
register(12, 'december', 'dec')

// Italian
register(1, 'gennaio', 'gen')
register(2, 'febbraio', 'feb')
register(3, 'marzo')
register(4, 'aprile')
register(5, 'maggio', 'mag')
register(6, 'giugno', 'giu')
register(7, 'luglio', 'lug')
register(8, 'agosto', 'ago')
register(9, 'settembre', 'set')
register(10, 'ottobre', 'ott')
register(11, 'novembre')
register(12, 'dicembre', 'dic')

// German. Abbreviations matter more here than elsewhere: German news sites
// routinely write "19. Jul. 2014", and the ones that collide with English
// (jan, feb, apr, aug, sep, nov) are already registered above.
register(1, 'januar', 'janner', 'jaen', 'jan')
register(2, 'februar')
register(3, 'marz', 'maerz', 'mrz')
register(5, 'mai')
register(6, 'juni')
register(7, 'juli')
register(9, 'sept')
register(10, 'oktober', 'okt')
register(12, 'dezember', 'dez')

// French
register(1, 'janvier', 'janv')
register(2, 'fevrier', 'fevr')
register(3, 'mars')
register(4, 'avril', 'avr')
register(5, 'mai')
register(6, 'juin')
register(7, 'juillet', 'juil')
register(8, 'aout')
register(9, 'septembre')
register(10, 'octobre')
register(11, 'novembre')
register(12, 'decembre')

// Spanish / Portuguese
register(1, 'enero', 'janeiro')
register(2, 'febrero', 'fevereiro')
register(3, 'marzo', 'marco')
register(4, 'abril')
register(5, 'mayo', 'maio')
register(6, 'junio', 'junho')
register(7, 'julio', 'julho')
register(8, 'agosto')
register(9, 'septiembre', 'setembro')
register(10, 'octubre', 'outubro')
register(11, 'noviembre', 'novembro')
register(12, 'diciembre', 'dezembro')

// Dutch
register(1, 'januari')
register(2, 'februari')
register(3, 'maart')
register(5, 'mei')
register(6, 'juni')
register(7, 'juli')
register(8, 'augustus')
register(10, 'oktober')

/** Strip diacritics and lowercase, so `Février` matches `fevrier`. */
export function foldCase(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .toLowerCase()
}

/** Resolve a month name in any supported language to its 1-indexed number. */
export function monthFromName(name: string): number | undefined {
  return MONTHS[foldCase(name).replace(/\.$/, '')]
}

/** Regex alternation matching any known month name, longest-first. */
export const MONTH_NAME_PATTERN = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|')

/**
 * Decide day-first vs month-first from the document's own declarations.
 *
 * `<html lang>` is checked before the TLD because a `.com` site serving Italian
 * is far more common than an `.it` site serving American English.
 */
export function detectDayFirst(lang?: string | null, hostname?: string): DayFirstHint {
  const normalised = lang?.trim().toLowerCase()

  if (normalised) {
    if (MONTH_FIRST_LANGS.has(normalised)) return 'month-first'
    // A bare `en` is genuinely ambiguous — en-GB is day-first, en-US is not.
    if (normalised !== 'en' && !normalised.startsWith('en-')) return 'day-first'
    if (normalised.startsWith('en-')) return 'day-first'
  }

  const tld = hostname?.split('.').pop()?.toLowerCase()
  if (tld) {
    if (MONTH_FIRST_TLDS.has(tld)) return 'month-first'
    // Two-letter ccTLDs other than `.us` are day-first territory.
    if (tld.length === 2) return 'day-first'
  }

  return 'unknown'
}
