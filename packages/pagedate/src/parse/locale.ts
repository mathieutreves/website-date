/**
 * Language data: month names, digit systems, and the DD/MM-vs-MM/DD hint.
 *
 * Guessing wrong here silently corrupts a date rather than failing loudly, so
 * where a reading is genuinely ambiguous the parser drops precision instead of
 * choosing. See docs/DESIGN.md §4.7.
 */

/** Which component comes first in an all-numeric date like `03/04/2024`. */
export type DayFirstHint = 'day-first' | 'month-first' | 'unknown'

/**
 * Locales that write month-first. Everything else on earth is day-first, so
 * this is an allow-list rather than the other way round.
 */
const MONTH_FIRST_LANGS = new Set(['en-us', 'en-ph'])
const MONTH_FIRST_TLDS = new Set(['us', 'ph'])

/**
 * Languages that write year-first (`2024-03-12`), which is unambiguous anyway
 * but worth not mistaking for day-first.
 */
const YEAR_FIRST_LANGS = new Set(['zh', 'ja', 'ko', 'hu', 'lt'])

/** Month names normalised to lowercase without diacritics. Value is 1-indexed. */
const MONTHS: Record<string, number> = {}

function register(month: number, ...names: string[]): void {
  // Folded on the way in, so table keys and lookup input are always normalised
  // the same way and MONTH_NAME_PATTERN is built from matchable forms.
  for (const name of names) MONTHS[foldCase(name)] = month
}

/**
 * Register twelve names at once, in calendar order.
 *
 * Names must already be folded — lowercase, diacritics stripped — because
 * lookup folds its input before matching. `Märt` is registered as `marz`.
 */
function registerYear(...names: string[]): void {
  names.forEach((name, index) => {
    if (name) register(index + 1, name)
  })
}

// -------------------------------------------------------------- Germanic

// English
registerYear('january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december')
registerYear('jan', 'feb', 'mar', 'apr', '', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec')
register(9, 'sept')

// German. Abbreviations matter more here than elsewhere — German news sites
// routinely write "19. Jul. 2014".
registerYear('januar', 'februar', 'marz', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'dezember')
register(1, 'janner', 'jaenner')
register(3, 'maerz', 'mrz')
register(10, 'okt')
register(12, 'dez')

// Dutch
registerYear('januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december')

// Swedish / Danish / Norwegian
registerYear('januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december')
register(3, 'marts')
register(5, 'mai')
register(12, 'desember')

// Finnish uses the partitive in dates: "12. maaliskuuta 2024".
registerYear('tammikuuta', 'helmikuuta', 'maaliskuuta', 'huhtikuuta', 'toukokuuta', 'kesakuuta',
  'heinakuuta', 'elokuuta', 'syyskuuta', 'lokakuuta', 'marraskuuta', 'joulukuuta')
registerYear('tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesakuu',
  'heinakuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu')

// --------------------------------------------------------------- Romance

// Italian
registerYear('gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre')
register(1, 'gen')
register(5, 'mag')
register(6, 'giu')
register(7, 'lug')
register(9, 'set')
register(10, 'ott')
register(12, 'dic')

// French
registerYear('janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre')
register(1, 'janv')
register(2, 'fevr')
register(4, 'avr')
register(7, 'juil')

// Spanish
registerYear('enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre')
register(9, 'setiembre')

// Portuguese
registerYear('janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro')

// Romanian
registerYear('ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie')

// Catalan
registerYear('gener', 'febrer', 'marc', 'abril', 'maig', 'juny',
  'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre')

// ---------------------------------------------------------------- Slavic

/*
 * Slavic languages inflect the month in a date: Russian writes "12 марта
 * 2024" (genitive), not "март". Registering only the dictionary form would
 * miss essentially every real date, so both are registered throughout.
 */

// Russian — genitive then nominative
registerYear('января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря')
registerYear('январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь')

// Ukrainian
registerYear('січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня')
registerYear('січень', 'лютий', 'березень', 'квітень', 'травень', 'червень',
  'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень')

// Polish
registerYear('stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'wrzesnia', 'pazdziernika', 'listopada', 'grudnia')
registerYear('styczen', 'luty', 'marzec', 'kwiecien', 'maj', 'czerwiec',
  'lipiec', 'sierpien', 'wrzesien', 'pazdziernik', 'listopad', 'grudzien')

// Czech
registerYear('ledna', 'unora', 'brezna', 'dubna', 'kvetna', 'cervna',
  'cervence', 'srpna', 'zari', 'rijna', 'listopadu', 'prosince')
registerYear('leden', 'unor', 'brezen', 'duben', 'kveten', 'cerven',
  'cervenec', 'srpen', 'zari', 'rijen', 'listopad', 'prosinec')

// ---------------------------------------------------------------- others

// Turkish. `ı` is a distinct letter with no decomposition, so the dotless
// form is registered alongside an ASCII fallback.
registerYear('ocak', 'subat', 'mart', 'nisan', 'mayıs', 'haziran',
  'temmuz', 'agustos', 'eylul', 'ekim', 'kasım', 'aralık')
register(5, 'mayis')
register(11, 'kasim')
register(12, 'aralik')

// Greek — genitive, as used in dates
registerYear('ιανουαριου', 'φεβρουαριου', 'μαρτιου', 'απριλιου', 'μαιου', 'ιουνιου',
  'ιουλιου', 'αυγουστου', 'σεπτεμβριου', 'οκτωβριου', 'νοεμβριου', 'δεκεμβριου')
registerYear('ιανουαριος', 'φεβρουαριος', 'μαρτιος', 'απριλιος', 'μαιος', 'ιουνιος',
  'ιουλιος', 'αυγουστος', 'σεπτεμβριος', 'οκτωβριος', 'νοεμβριος', 'δεκεμβριος')

// Hungarian
registerYear('januar', 'februar', 'marcius', 'aprilis', 'majus', 'junius',
  'julius', 'augusztus', 'szeptember', 'oktober', 'november', 'december')

// Indonesian / Malay
registerYear('januari', 'februari', 'maret', 'april', 'mei', 'juni',
  'juli', 'agustus', 'september', 'oktober', 'november', 'desember')

// Arabic — Gulf/Egyptian naming
registerYear('يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر')
// Arabic — Levantine naming, which is unrelated to the above
registerYear('كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول')

// Hebrew
registerYear('ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר')

// Hindi
registerYear('जनवरी', 'फरवरी', 'मार्च', 'अप्रैल', 'मई', 'जून',
  'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर')

// ------------------------------------------------------------- numerals

/**
 * Digit systems other than ASCII, mapped to their ASCII equivalents.
 *
 * Arabic and Persian pages frequently render dates in their own numerals, and
 * a parser that only knows 0-9 sees no date at all on those pages.
 */
const DIGIT_RANGES: Array<[number, string]> = [
  [0x0660, 'arabic-indic'],
  [0x06f0, 'extended-arabic-indic'],
  [0x0966, 'devanagari'],
  [0x0e50, 'thai'],
  [0xff10, 'fullwidth'],
]

/** Rewrite non-ASCII digits as ASCII, leaving everything else untouched. */
export function normaliseDigits(input: string): string {
  let out = ''
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0
    let mapped = char
    for (const [base] of DIGIT_RANGES) {
      if (code >= base && code <= base + 9) {
        mapped = String(code - base)
        break
      }
    }
    out += mapped
  }
  return out
}

/**
 * Strip diacritics and lowercase, so `Février` matches `fevrier`.
 *
 * Only combining marks in the Latin/Greek/Cyrillic range are removed. Arabic
 * and Indic vowel signs sit outside it and are meaning-bearing, so they stay.
 */
export function foldCase(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // combining diacritical marks
      // Recompose. NFD shatters Hangul syllables into jamo and splits Arabic
      // `آ` into alef plus maddah; both survive the strip above unchanged but
      // in decomposed form, which would never match a composed table entry.
      .normalize('NFC')
      .toLowerCase()
  )
}

/** Resolve a month name in any supported language to its 1-indexed number. */
export function monthFromName(name: string): number | undefined {
  return MONTHS[foldCase(name).replace(/\.$/, '').trim()]
}

/**
 * Regex alternation matching any known month name, longest-first so that
 * `september` wins over `sep` and `канун الثاني` is not truncated.
 */
export const MONTH_NAME_PATTERN = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

/**
 * CJK dates are structural rather than named: `2024年3月12日`. Korean uses the
 * same shape with its own markers, and Japanese shares Chinese ones.
 */
export const CJK_DATE_PATTERN =
  '\\d{4}\\s*[年년]\\s*\\d{1,2}\\s*[月월]\\s*\\d{1,2}\\s*[日일]|\\d{4}\\s*[年년]\\s*\\d{1,2}\\s*[月월]'

/**
 * Decide day-first vs month-first from the document's own declarations.
 *
 * `<html lang>` is checked before the TLD because a `.com` serving Italian is
 * far more common than an `.it` serving American English.
 */
export function detectDayFirst(lang?: string | null, hostname?: string): DayFirstHint {
  const normalised = lang?.trim().toLowerCase()

  if (normalised) {
    if (MONTH_FIRST_LANGS.has(normalised)) return 'month-first'
    const base = normalised.split('-')[0] ?? ''
    if (YEAR_FIRST_LANGS.has(base)) return 'day-first'
    // A bare `en` is genuinely ambiguous — en-GB is day-first, en-US is not.
    if (normalised !== 'en') return 'day-first'
  }

  const tld = hostname?.split('.').pop()?.toLowerCase()
  if (tld) {
    if (MONTH_FIRST_TLDS.has(tld)) return 'month-first'
    // Two-letter ccTLDs other than the month-first ones are day-first territory.
    if (tld.length === 2) return 'day-first'
  }

  return 'unknown'
}
