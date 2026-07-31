/**
 * Fill in the strata that need the fetched HTML: language, and whether the
 * label is present in the page at all.
 *
 *   node scripts/corpus/enrich.ts
 *
 * A permalink label says "this was published on 2012-11-01". For most pages the
 * document says so too, somewhere. For some — old markup, JS-rendered datelines,
 * captures that dropped the byline — it does not, and the date exists *only* in
 * the URL. Under `holdOut` those entries are unanswerable by construction: no
 * extractor could recover the label without reading the URL, which is the one
 * thing it is forbidden to read.
 *
 * Scoring them punishes an extractor for correctly finding nothing.
 *
 * **This check must not use the extractors.** The obvious implementation — ask
 * pagedate for every candidate and see whether the label is among them — marks
 * exactly the pages pagedate fails on as "unanswerable", then excludes them, and
 * reports a higher number. That is circular, and it is how a benchmark quietly
 * starts flattering its author. So this is a plain string search over the raw
 * HTML for the label date in every rendering a page plausibly uses, in the
 * languages the corpus actually contains.
 *
 * Sets `strata.labelInPage`. Nothing is deleted: the scorer decides what to do.
 *
 * Also sets `strata.lang`, without which "does this work outside English?" is
 * unanswerable — and it is the question this corpus exists to answer, the
 * htmldate set being almost entirely German. Read from the document's own
 * `<html lang>` where there is one, since a guess from the TLD puts every `.com`
 * in the same bucket regardless of what it publishes.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readManifest, writeFileAtomic, writeManifest, type CorpusEntry } from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MANIFEST = join(ROOT, 'corpus', 'manifest.jsonl')
const CACHE = join(ROOT, 'corpus', 'cache')

/** Month names for the languages present in seeds.txt, diacritics stripped. */
const MONTHS: Record<string, string[][]> = {
  en: [['january', 'jan'], ['february', 'feb'], ['march', 'mar'], ['april', 'apr'], ['may'], ['june', 'jun'], ['july', 'jul'], ['august', 'aug'], ['september', 'sep', 'sept'], ['october', 'oct'], ['november', 'nov'], ['december', 'dec']],
  it: [['gennaio', 'gen'], ['febbraio', 'feb'], ['marzo', 'mar'], ['aprile', 'apr'], ['maggio', 'mag'], ['giugno', 'giu'], ['luglio', 'lug'], ['agosto', 'ago'], ['settembre', 'set'], ['ottobre', 'ott'], ['novembre', 'nov'], ['dicembre', 'dic']],
  de: [['januar', 'jan'], ['februar', 'feb'], ['marz', 'mar'], ['april', 'apr'], ['mai'], ['juni', 'jun'], ['juli', 'jul'], ['august', 'aug'], ['september', 'sep'], ['oktober', 'okt'], ['november', 'nov'], ['dezember', 'dez']],
  fr: [['janvier', 'janv'], ['fevrier', 'fev'], ['mars'], ['avril', 'avr'], ['mai'], ['juin'], ['juillet', 'juil'], ['aout'], ['septembre', 'sept'], ['octobre', 'oct'], ['novembre', 'nov'], ['decembre', 'dec']],
  es: [['enero', 'ene'], ['febrero', 'feb'], ['marzo', 'mar'], ['abril', 'abr'], ['mayo'], ['junio', 'jun'], ['julio', 'jul'], ['agosto', 'ago'], ['septiembre', 'sep'], ['octubre', 'oct'], ['noviembre', 'nov'], ['diciembre', 'dic']],
  nl: [['januari'], ['februari'], ['maart'], ['april'], ['mei'], ['juni'], ['juli'], ['augustus'], ['september'], ['oktober'], ['november'], ['december']],
  pt: [['janeiro'], ['fevereiro'], ['marco'], ['abril'], ['maio'], ['junho'], ['julho'], ['agosto'], ['setembro'], ['outubro'], ['novembro'], ['dezembro']],
  pl: [['stycznia'], ['lutego'], ['marca'], ['kwietnia'], ['maja'], ['czerwca'], ['lipca'], ['sierpnia'], ['wrzesnia'], ['pazdziernika'], ['listopada'], ['grudnia']],
  // Genitive, which is the form a Russian date actually uses: "12 марта 2024",
  // never the nominative "март" a dictionary would give.
  ru: [['января'], ['февраля'], ['марта'], ['апреля'], ['мая'], ['июня'], ['июля'], ['августа'], ['сентября'], ['октября'], ['ноября'], ['декабря']],
  // Al Jazeera uses the Western-derived month names rather than the Levantine
  // set (كانون الثاني and friends); both are listed because Arabic-language
  // sites are split roughly down the middle on which they use.
  ar: [['يناير', 'كانون الثاني'], ['فبراير', 'شباط'], ['مارس', 'اذار'], ['ابريل', 'نيسان'], ['مايو', 'ايار'], ['يونيو', 'حزيران'], ['يوليو', 'تموز'], ['اغسطس', 'اب'], ['سبتمبر', 'ايلول'], ['اكتوبر', 'تشرين الاول'], ['نوفمبر', 'تشرين الثاني'], ['ديسمبر', 'كانون الاول']],
}

/**
 * Digit systems a corpus page may write its date in.
 *
 * Arabic pages routinely render the day and year in Arabic-Indic digits, and a
 * search for `2015` finds nothing on a page that says `٢٠١٥`. Without this the
 * whole Arabic stratum reads as "the label is not in the page" and gets
 * excluded from scoring — the corpus would look clean while measuring nothing.
 */
const DIGIT_SETS = ['٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹']

const inDigits = (ascii: string, digits: string): string =>
  ascii.replace(/\d/g, (c) => digits[Number(c)]!)

const fold = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const DIGIT = /[0-9٠-٩۰-۹]/

/**
 * Does a rendering appear in the page as a date, rather than inside a longer number?
 *
 * A plain `includes` cannot tell the two apart, and one of the renderings is the
 * bare 8-digit `20121101`, which is a substring of any longer digit run
 * containing it. Il Post captions its photos `Toms River, New Jersey (AP
 * Photo/Matt Slocum) 2012110183`, and that asset ID was matching as the
 * article's date.
 *
 * Requiring a non-digit on both sides is the whole fix. It costs nothing on the
 * textual forms, where the boundary is a space or a tag either way.
 *
 * On the corpus as it stands this changes no entry's flag: the pages it stops
 * matching spuriously are matched anyway by the date in a nearby permalink. It
 * is here so that the flag is not resting on a coincidence the next harvest may
 * not repeat.
 */
function appearsIn(haystack: string, form: string): boolean {
  for (let i = haystack.indexOf(form); i >= 0; i = haystack.indexOf(form, i + 1)) {
    const before = i > 0 ? haystack[i - 1]! : ''
    const after = haystack[i + form.length] ?? ''
    if (!DIGIT.test(before) && !DIGIT.test(after)) return true
  }
  return false
}

/** Every plausible rendering of a date, as substrings to look for. */
function renderings(iso: string): string[] {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return [iso]
  const mi = Number(m) - 1
  const dn = String(Number(d))
  const mn = String(Number(m))
  const out = new Set<string>([
    `${y}-${m}-${d}`, `${y}/${m}/${d}`, `${y}.${m}.${d}`, `${y}${m}${d}`,
    `${d}-${m}-${y}`, `${d}/${m}/${y}`, `${d}.${m}.${y}`,
    `${m}/${d}/${y}`, `${m}-${d}-${y}`,
    `${dn}/${mn}/${y}`, `${mn}/${dn}/${y}`, `${dn}.${mn}.${y}`,
    // Year-first without zero padding — `2015.4.23`, the ordinary written form
    // in Japan and Korea. WIRED.jp and Japanese Engadget print the date this way
    // and no other, so without these forms the flag was true for those pages
    // only because the date also appears in a permalink, which is the one signal
    // the corpus holds out. Same verdict, better reason.
    `${y}.${mn}.${dn}`, `${y}/${mn}/${dn}`, `${y}-${mn}-${dn}`,
  ])
  for (const names of Object.values(MONTHS)) {
    for (const name of names[mi] ?? []) {
      out.add(`${name} ${dn}, ${y}`)
      out.add(`${name} ${dn} ${y}`)
      out.add(`${name} ${d}, ${y}`)
      out.add(`${dn} ${name} ${y}`)
      out.add(`${d} ${name} ${y}`)
      out.add(`${dn}. ${name} ${y}`)
      out.add(`${dn}.${name} ${y}`)
      out.add(`${name} ${y}`) // last resort: month + year adjacent
    }
  }

  // CJK writes the date structurally rather than with a month name:
  // `2024年3月12日`, and just as often zero-padded. None of the separators above
  // appear, so without this every Japanese page reads as label-not-present.
  out.add(`${y}年${mn}月${dn}日`)
  out.add(`${y}年${m}月${d}日`)
  out.add(`${y}년 ${mn}월 ${dn}일`)

  // Same date, non-ASCII digits — see DIGIT_SETS.
  for (const digits of DIGIT_SETS) {
    for (const form of [...out]) {
      if (/\d/.test(form)) out.add(inDigits(form, digits))
    }
  }
  return [...out]
}

/**
 * Language, from the document's own declaration.
 *
 * `<html lang>` first, then the `og:locale` a CMS emits when the template
 * forgot the attribute, then a TLD fallback for the country domains where it is
 * a safe read. Regional subtags are dropped — `en-GB` and `en-US` are one
 * language for the purpose of parsing a date, and splitting them would shatter
 * an already small per-language sample. Deliberately no text-based language
 * detection: a wrong guess here silently mislabels a whole stratum, and
 * "unknown" is a more useful answer than a confident error.
 */
const TLD_LANG: Record<string, string> = {
  de: 'de', at: 'de', ch: 'de',
  fr: 'fr', it: 'it', es: 'es', nl: 'nl', pl: 'pl', pt: 'pt', br: 'pt',
  dk: 'da', se: 'sv', no: 'no', fi: 'fi', cz: 'cs', ru: 'ru',
  jp: 'ja', cn: 'zh', kr: 'ko',
}

/**
 * Writing systems that identify a language on sight.
 *
 * Order matters. Japanese is tested before Chinese because Japanese text is
 * mostly CJK ideographs with kana mixed in — testing for ideographs first would
 * call every Japanese page Chinese. Ukrainian before Russian for the same
 * reason: it is Cyrillic plus four letters Russian does not have.
 */
const SCRIPTS: Array<[string, RegExp]> = [
  ['ja', /[぀-ゟ゠-ヿ]/g], // kana
  ['ko', /[가-힯ᄀ-ᇿ]/g], // hangul
  ['zh', /[一-鿿]/g], // ideographs, after kana and hangul
  ['uk', /[іїєґІЇЄҐ]/g],
  ['ru', /[Ѐ-ӿ]/g],
  ['el', /[Ͱ-Ͽ]/g],
  ['he', /[֐-׿]/g],
  ['fa', /[پچژگ]/g],
  ['ar', /[؀-ۿ]/g],
  ['hi', /[ऀ-ॿ]/g],
  ['th', /[฀-๿]/g],
]

/**
 * Function words for the Latin-script languages in the corpus.
 *
 * Function words rather than content words: they are the highest-frequency
 * tokens in any text and the least likely to be a borrowed brand name. Scored by
 * count, so a page needs several hits rather than one — "de" alone appears in
 * English text as often as in Portuguese.
 */
const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'is', 'that', 'for', 'with', 'this', 'from'],
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'ein', 'auch', 'mit', 'sich'],
  fr: ['les', 'des', 'est', 'une', 'pour', 'que', 'dans', 'sur', 'pas', 'avec'],
  es: ['que', 'los', 'las', 'del', 'una', 'por', 'para', 'con', 'como', 'este'],
  it: ['che', 'per', 'della', 'sono', 'con', 'una', 'nel', 'alla', 'anche', 'come'],
  pt: ['que', 'uma', 'para', 'com', 'nao', 'dos', 'como', 'mais', 'pelo', 'seu'],
  nl: ['het', 'een', 'van', 'niet', 'dat', 'zijn', 'voor', 'met', 'ook', 'aan'],
  pl: ['nie', 'sie', 'jest', 'что', 'przez', 'oraz', 'tego', 'jako', 'ktory', 'jeden'],
  sv: ['och', 'att', 'som', 'for', 'med', 'den', 'har', 'inte', 'pa', 'ar'],
  da: ['og', 'det', 'som', 'til', 'med', 'ikke', 'har', 'den', 'af', 'for'],
  no: ['og', 'det', 'som', 'til', 'med', 'ikke', 'har', 'den', 'av', 'for'],
  fi: ['ja', 'on', 'ei', 'etta', 'joka', 'sen', 'ovat', 'myos', 'kuin', 'han'],
  cs: ['je', 'na', 'se', 'ale', 'pro', 'jako', 'jsou', 'nebo', 'tak', 'ktery'],
  tr: ['bir', 've', 'bu', 'ile', 'icin', 'daha', 'olarak', 'gibi', 'kadar', 'sonra'],
  id: ['yang', 'dan', 'dengan', 'untuk', 'dari', 'pada', 'tidak', 'ini', 'akan', 'adalah'],
  ro: ['este', 'care', 'pentru', 'din', 'sunt', 'mai', 'sau', 'dar', 'cu', 'ca'],
  hu: ['hogy', 'nem', 'egy', 'volt', 'meg', 'csak', 'majd', 'mint', 'ezt', 'ami'],
  vi: ['va', 'cua', 'khong', 'duoc', 'nhung', 'cho', 'trong', 'nguoi', 'mot', 'nay'],
}

/**
 * Language from the page's own text, when the markup does not say.
 *
 * `<html lang>` is right when it is present and it is the first thing tried.
 * When it is absent the old fallback was the TLD, which puts every `.com` in
 * one bucket regardless of what it publishes — and that bucket was the corpus's
 * second-worst stratum while containing `japanese.engadget.com` and `cctv.com`.
 * A stratum that mixes six languages together cannot answer the question the
 * language table exists to answer.
 *
 * This is deliberately a *stratum* label and not an answer key. It decides how
 * results are grouped for reporting, never what the right date is, so a
 * mechanical classifier is appropriate here in a way it would not be for
 * `label.published` — see CONTRIBUTING.md.
 */
function detectFromText(html: string): string | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .slice(0, 300_000)

  // A script hit is decisive: no amount of English boilerplate makes a page with
  // 400 kana characters an English page. The floor rejects the stray emoji or
  // the one Chinese word in a font stack.
  for (const [lang, pattern] of SCRIPTS) {
    const hits = text.match(pattern)?.length ?? 0
    if (hits >= 40) return lang
  }

  const words = text.toLowerCase().match(/[a-zà-ÿ]{2,}/g)
  if (!words || words.length < 60) return null
  const counts = new Map<string, number>()
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)

  let best: string | null = null
  let bestScore = 0
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    let score = 0
    for (const w of list) score += counts.get(w) ?? 0
    if (score > bestScore) {
      bestScore = score
      best = lang
    }
  }
  // A handful of hits is chance. Requiring a real count is what keeps a page of
  // product names from being assigned a language at all.
  return bestScore >= 12 ? best : null
}

function detectLang(html: string, entry: CorpusEntry): string {
  const attr = /<html[^>]*\slang\s*=\s*["']?([a-zA-Z]{2,3})(?:[-_][a-zA-Z]+)?/i.exec(html)
  if (attr?.[1]) return attr[1].toLowerCase()

  const og = /property\s*=\s*["']og:locale["'][^>]*content\s*=\s*["']([a-zA-Z]{2,3})/i.exec(html)
  if (og?.[1]) return og[1].toLowerCase()

  // Before the TLD, not after: the TLD is a guess about the registrar and the
  // text is evidence about the document. `.com` has no language at all, which is
  // why 606 pages had none.
  const fromText = detectFromText(html)
  if (fromText) return fromText

  return TLD_LANG[entry.strata.tld] ?? 'unknown'
}

async function main(): Promise<void> {
  const entries = readManifest(await readFile(MANIFEST, 'utf8'))
  let checked = 0
  let present = 0
  let negatives = 0
  const absentByYear = new Map<number | null, number>()
  const byLang = new Map<string, number>()

  for (const entry of entries as CorpusEntry[]) {
    if (!entry.fetch) continue
    let raw: string
    try {
      raw = await readFile(join(CACHE, `${entry.id}.html`), 'utf8')
    } catch {
      continue
    }
    const html = fold(raw)

    // Read from the unfolded source: `lang` is an attribute, not prose, and
    // folding is only needed for the month-name search below.
    const lang = detectLang(raw, entry)
    entry.strata.lang = lang
    byLang.set(lang, (byLang.get(lang) ?? 0) + 1)

    // Negatives get a language and stop there. `labelInPage` asks whether the
    // label date appears in the document, and a negative entry has no label
    // date to look for — the question is not false for them, it is undefined.
    // They are counted separately so the totals below still add up.
    if (!entry.label.published) {
      negatives++
      continue
    }
    checked++

    // Strip the URL itself out of the haystack: many pages link to themselves,
    // and finding the date there is finding the URL again.
    const withoutSelf = html.split(fold(new URL(entry.url).pathname)).join(' ')
    const found = renderings(entry.label.published).some((form) => appearsIn(withoutSelf, form))

    entry.strata.labelInPage = found
    if (found) present++
    else absentByYear.set(entry.strata.era, (absentByYear.get(entry.strata.era) ?? 0) + 1)
  }

  await writeFileAtomic(MANIFEST, writeManifest(entries))

  console.log(`\n${checked} labelled+fetched entries checked`)
  console.log(`  label appears in the page : ${present}`)
  console.log(`  label ONLY in the URL     : ${checked - present}`)
  if (negatives) console.log(`  negatives (lang only)     : ${negatives}`)
  console.log(
    `\n  absent by year: ${[...absentByYear.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([year, n]) => `${year}:${n}`)
      .join(' ')}`,
  )
  console.log(
    `\n  languages: ${[...byLang.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([lang, n]) => `${lang}:${n}`)
      .join(' ')}`,
  )
  console.log(`\nRe-run score.ts; it excludes these from the headline by default.`)
}

await main()
