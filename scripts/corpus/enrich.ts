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
}

const fold = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

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

function detectLang(html: string, entry: CorpusEntry): string {
  const attr = /<html[^>]*\slang\s*=\s*["']?([a-zA-Z]{2,3})(?:[-_][a-zA-Z]+)?/i.exec(html)
  if (attr?.[1]) return attr[1].toLowerCase()

  const og = /property\s*=\s*["']og:locale["'][^>]*content\s*=\s*["']([a-zA-Z]{2,3})/i.exec(html)
  if (og?.[1]) return og[1].toLowerCase()

  return TLD_LANG[entry.strata.tld] ?? 'unknown'
}

async function main(): Promise<void> {
  const entries = readManifest(await readFile(MANIFEST, 'utf8'))
  let checked = 0
  let present = 0
  const absentByYear = new Map<number | null, number>()
  const byLang = new Map<string, number>()

  for (const entry of entries as CorpusEntry[]) {
    if (!entry.fetch || !entry.label.published) continue
    let raw: string
    try {
      raw = await readFile(join(CACHE, `${entry.id}.html`), 'utf8')
    } catch {
      continue
    }
    const html = fold(raw)
    checked++

    // Read from the unfolded source: `lang` is an attribute, not prose, and
    // folding is only needed for the month-name search below.
    const lang = detectLang(raw, entry)
    entry.strata.lang = lang
    byLang.set(lang, (byLang.get(lang) ?? 0) + 1)

    // Strip the URL itself out of the haystack: many pages link to themselves,
    // and finding the date there is finding the URL again.
    const withoutSelf = html.split(fold(new URL(entry.url).pathname)).join(' ')
    const found = renderings(entry.label.published).some((form) => withoutSelf.includes(form))

    entry.strata.labelInPage = found
    if (found) present++
    else absentByYear.set(entry.strata.era, (absentByYear.get(entry.strata.era) ?? 0) + 1)
  }

  await writeFileAtomic(MANIFEST, writeManifest(entries))

  console.log(`\n${checked} labelled+fetched entries checked`)
  console.log(`  label appears in the page : ${present}`)
  console.log(`  label ONLY in the URL     : ${checked - present}`)
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
