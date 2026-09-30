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
 * Country-code TLDs used as generic ones. An American startup on `.io` or `.ai`
 * is the ordinary case, so the TLD is no evidence of day-first dates.
 */
const GENERIC_CC_TLDS = new Set([
  'ai', 'bz', 'cc', 'co', 'fm', 'gg', 'im', 'io', 'is', 'la', 'ly', 'me', 'nu', 'sh', 'to', 'tv', 'ws',
])

/**
 * Languages that write year-first (`2024-03-12`), which is unambiguous anyway
 * but worth not mistaking for day-first.
 */
const YEAR_FIRST_LANGS = new Set(['zh', 'ja', 'ko', 'hu', 'lt'])

/** Anything outside ASCII needs the full Unicode path; most text does not. */
const NON_ASCII = /[^\x00-\x7f]/

/**
 * Month names normalised to lowercase without diacritics. Value is 1-indexed.
 *
 * Null-prototype because the key is page data. The RFC-2822 branch of
 * {@link parseDateString} captures a month as `[A-Za-z]{3,}`, so `"12 constructor
 * 2024"` reaches this lookup — and on a plain object that returns a *function*,
 * which the `undefined` check downstream does not catch. It survived only
 * because the invalid-date round-trip rejected it two steps later. Removing the
 * prototype removes the class of accident rather than the one instance.
 */
const MONTHS: Record<string, number> = Object.create(null)

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

// Bulgarian
registerYear('януари', 'февруари', 'март', 'април', 'май', 'юни',
  'юли', 'август', 'септември', 'октомври', 'ноември', 'декември')

// Serbian, in both of its scripts
registerYear('јануар', 'фебруар', 'март', 'април', 'мај', 'јун',
  'јул', 'август', 'септембар', 'октобар', 'новембар', 'децембар')
registerYear('januar', 'februar', 'mart', 'april', 'maj', 'jun',
  'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar')

// Slovak — genitive, as used in dates. Croatian is deliberately absent: its
// `listopada` is October and Polish `listopada` is November, and a table keyed
// on the name alone cannot hold both.
registerYear('januara', 'februara', 'marca', 'aprila', 'maja', 'juna',
  'jula', 'augusta', 'septembra', 'oktobra', 'novembra', 'decembra')

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

// Arabic — Maghrebi naming, which borrows from French in Tunisia and Algeria
// ("جانفي" is janvier) and from Spanish in Morocco ("غشت" is agosto). WordPress
// localises to these, so a blog in Tunis writes "ماي 25, 2025" and none of the
// twelve names above matches it.
registerYear('جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان',
  'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر')
registerYear('يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو',
  'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر')

// Persian names for the Gregorian months. Jalali dates are a different
// calendar and are not read at all.
registerYear('ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
  'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر')

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
  // Every range below starts well above ASCII, so pure-ASCII text cannot contain
  // a digit this rewrites and is returned unchanged. Worth the check: this runs
  // on every string `parseDateString` is handed, and the loop it skips is
  // per-character with a nested scan over all five ranges. Same reasoning as
  // `foldCase` below.
  if (!NON_ASCII.test(input)) return input

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
  // Pure-ASCII text has no diacritics to strip and nothing to recompose, so it
  // can skip two Unicode normalisation passes. Most text on most pages, in the
  // languages that dominate the web, takes this path.
  if (!NON_ASCII.test(input)) return input.toLowerCase()

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
 * Characters that make whatever follows them the inside of a word, as a
 * character-class body: ASCII letters and digits, then Latin with diacritics,
 * Greek, Cyrillic, Hebrew, Arabic and Devanagari.
 *
 * Scripts written without spaces are left out on purpose. `投稿日2024年3月12日`
 * runs a label straight into a date, and in Thai a month name follows its
 * neighbour with nothing between them; a boundary test there would reject real
 * dates rather than accidents.
 */
const WORD_CHARS = 'A-Za-z0-9\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u052F\\u0590-\\u06FF\\u0900-\\u097F'

/** Lookbehind: not in the middle of a word. */
export const NOT_MID_WORD = `(?<![${WORD_CHARS}])`

/**
 * Month names as they are *searched for* in running text, as opposed to parsed
 * out of a string already known to be a date.
 *
 * A short name is also the tail of ordinary words. `mart` is Turkish for March
 * and the end of "Smart", `set` is Portuguese for September and the end of
 * "Sunset", `ott` is Italian for October and the end of "Marriott" — so
 * "Walmart 2024 Report" read as March 2024 and "Copenhagen 2019" as January.
 * Names of four letters or fewer therefore have to start a word.
 *
 * Longer names are left unanchored. Nothing ends in "september", and markup
 * that renders a label and a date from adjacent elements really does produce
 * "PostedSeptember 12, 2024" once the text is joined.
 */
export const MONTH_NAME_IN_TEXT = (() => {
  const names = Object.keys(MONTHS)
    .sort((a, b) => b.length - a.length)
    .map((name) => ({ name, source: name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }))
  const long = names.filter(({ name }) => name.length > 4).map(({ source }) => source)
  const short = names.filter(({ name }) => name.length <= 4).map(({ source }) => source)
  return `${long.join('|')}|${NOT_MID_WORD}(?:${short.join('|')})`
})()

/**
 * Ordinal suffix that may follow the day number: "November 1st, 2012",
 * "le 1er mars 2013", "1º marzo 2013", "3e januari".
 *
 * Both the accented and folded spellings are listed, because this pattern is
 * matched against folded text in the extractors and against raw `title`
 * attributes elsewhere — `ère` reaches one as `ere` and the other intact.
 *
 * Omitting this is not a cosmetic gap. English writing before roughly 2015
 * favours the ordinal form, so a matcher without it does not merely lose the
 * day and keep the month: it fails to recognise the phrase as a date at all and
 * the page falls through to whatever stale template date is lying around.
 */
export const ORDINAL_SUFFIX = '(?:st|nd|rd|th|ers?|[eè]re|[eè]me|º|ª|°|e)?'

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
  // `en_US` is not a valid language tag and is what a good many templates
  // write. Read as written it is "not `en`", which used to mean day-first.
  const normalised = lang?.trim().toLowerCase().replace(/_/g, '-')

  // Only a well-formed tag is evidence. `lang="default"` or a template
  // placeholder says nothing about how the page writes its dates.
  if (normalised && /^[a-z]{2,3}(?:-[a-z0-9]+)*$/.test(normalised)) {
    if (MONTH_FIRST_LANGS.has(normalised)) return 'month-first'
    const base = normalised.split('-')[0] ?? ''
    if (YEAR_FIRST_LANGS.has(base)) return 'day-first'
    // A bare `en` is genuinely ambiguous — en-GB is day-first, en-US is not.
    if (normalised !== 'en') return 'day-first'
  }

  const tld = hostname?.split('.').pop()?.toLowerCase()
  if (tld) {
    if (MONTH_FIRST_TLDS.has(tld)) return 'month-first'
    // Two-letter ccTLDs are day-first territory — except the ones sold as
    // generic domains, which say where the registry is and nothing about who
    // wrote the page.
    if (tld.length === 2 && !GENERIC_CC_TLDS.has(tld)) return 'day-first'
  }

  return 'unknown'
}
