/**
 * How often does the page contradict its own permalink?
 *
 *   node scripts/corpus/label-vs-page.ts --split dev
 *
 * The permalink labels in this corpus are silver: derived from `/2019/08/05/`,
 * never adjudicated by a person. That buys enormous scale and costs the one
 * thing a gold label has — agreement with the document.
 *
 * When a page **declares** a publication date in machine-readable metadata and
 * that date is not the one in its own URL, the scorer marks the extractor wrong
 * for reading the metadata. Sometimes that is right: a CMS stamps a migration
 * date and the URL preserves the real one. Sometimes it is exactly backwards:
 * the URL is a slug someone typed, or the post was drafted one day and published
 * the next, and the page's own statement is the better answer.
 *
 * Either way it is not an extraction failure, and counting it as one makes every
 * accuracy figure on this corpus a mix of two different things. This measures
 * how large that mix is.
 *
 * It deliberately reports rather than corrects. Deciding, per page, which of the
 * two is right is adjudication — a person's job, and the same rule that keeps
 * `harvest-negative.ts` from labelling its own candidates.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { isNegative, readManifest, splitOf, type CorpusEntry } from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MANIFEST = join(ROOT, 'corpus', 'manifest.jsonl')
const CACHE = join(ROOT, 'corpus', 'cache')

const { parseHtml } = await import(join(ROOT, 'packages', 'pagedate', 'dist', 'node', 'index.js'))
const { extractFromDocument, resolveCandidates } = await import(
  join(ROOT, 'packages', 'pagedate', 'dist', 'index.js')
)

const { values } = parseArgs({
  options: {
    split: { type: 'string', default: 'dev' },
    'max-lag': { type: 'string', default: '30' },
    examples: { type: 'string', default: '12' },
  },
})

if (values.split === 'test') {
  console.error('Refusing to read the held-out split. Use --split dev or diag.')
  process.exit(2)
}

const neutralise = (u: string): string =>
  u
    .replace(/\/(19|20)\d{2}\/\d{1,2}\/\d{1,2}(?=\/|$|[?#])/g, '/yr/mo/dy')
    .replace(/\/(19|20)\d{2}-\d{2}-\d{2}/g, '/yr-mo-dy')

function neutraliseDeclaredUrls(doc: Document): void {
  for (const el of doc.querySelectorAll('link[rel="canonical"]')) {
    const href = el.getAttribute('href')
    if (href) el.setAttribute('href', neutralise(href))
  }
  for (const el of doc.querySelectorAll('meta[property="og:url"], meta[name="og:url"]')) {
    const c = el.getAttribute('content')
    if (c) el.setAttribute('content', neutralise(c))
  }
}

const dayGap = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

async function main(): Promise<void> {
  const all = readManifest(await readFile(MANIFEST, 'utf8'))
  const entries = all.filter(
    (e) =>
      e.fetch &&
      !isNegative(e) &&
      e.label.published &&
      splitOf(e.strata.host) === values.split &&
      e.captureLagDays <= Number(values['max-lag']) &&
      e.strata.labelInPage !== false,
  )

  let withDeclared = 0
  const buckets = new Map<string, number>()
  const examples: Array<{ e: CorpusEntry; declared: string; gap: number; source: string }> = []

  for (const entry of entries) {
    let html: string
    try {
      html = await readFile(join(CACHE, `${entry.id}.html`), 'utf8')
    } catch {
      continue
    }
    const doc = parseHtml(html)
    const holdOut = new Set(entry.holdOut)
    if (holdOut.has('url-slug')) neutraliseDeclaredUrls(doc)
    const url = holdOut.has('url-slug') ? neutralise(entry.url) : entry.url

    const candidates = extractFromDocument(doc, url, { mode: 'standard' }).filter(
      (c: any) => !holdOut.has(c.source),
    )
    // Taken from the *resolved* result, not from the raw candidate list.
    //
    // Reading the raw list was the first version of this and it overstated the
    // disagreement badly: elconfidencial.com emits a broken
    // `itemprop=datePublished` of `1970-01-01T01:00` — Unix epoch zero from an
    // empty CMS field — on four pages, and the raw scan reported each as the
    // page contradicting its URL by 45 years. The library already rejects those
    // through the plausibility filter and answers correctly; only this tool was
    // fooled. A measurement of "how often does the page disagree" has to use
    // what the page is actually understood to say, which is the resolved value.
    const now = new Date(
      `${entry.snapshot.slice(0, 4)}-${entry.snapshot.slice(4, 6)}-${entry.snapshot.slice(6, 8)}T00:00:00Z`,
    )
    const resolved = resolveCandidates(candidates, { now }).published
    if (!resolved || resolved.confidence !== 'declared' || resolved.field !== 'published') continue
    const declared = resolved
    withDeclared++

    const day = declared.value.slice(0, 10)
    if (day.length < 10) continue
    const gap = dayGap(entry.label.published!, day)
    const bucket =
      gap === 0 ? 'agree' : Math.abs(gap) === 1 ? '±1 day' : Math.abs(gap) <= 7 ? '±2–7 days' : '> 7 days'
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
    if (gap !== 0 && Math.abs(gap) > 1 && examples.length < Number(values.examples)) {
      examples.push({ e: entry, declared: day, gap, source: declared.source })
    }
  }

  console.log(`\n${entries.length} scored pages in split "${values.split}"`)
  console.log(`${withDeclared} of them declare a publication date in machine-readable metadata\n`)
  console.log(`  agreement between the URL label and what the page declares:\n`)
  const order = ['agree', '±1 day', '±2–7 days', '> 7 days']
  for (const name of order) {
    const n = buckets.get(name) ?? 0
    const pct = withDeclared ? ((n / withDeclared) * 100).toFixed(1) : '0.0'
    console.log(`    ${name.padEnd(12)} ${String(n).padStart(5)}   ${pct.padStart(5)}%`)
  }

  const disagree = (buckets.get('±1 day') ?? 0) + (buckets.get('±2–7 days') ?? 0) + (buckets.get('> 7 days') ?? 0)
  console.log(
    `\n  ${disagree} pages (${((disagree / Math.max(1, withDeclared)) * 100).toFixed(1)}% of those that declare one)` +
      ` state a date their own URL contradicts.`,
  )
  console.log(
    `  On those, an extractor that reads the metadata correctly is scored WRONG.\n` +
      `  That is a ceiling on measured accuracy which no extraction work can lift.`,
  )

  if (examples.length) {
    console.log(`\n  beyond ±1 day — these are not timezone noise:\n`)
    for (const x of examples) {
      console.log(
        `    ${x.e.strata.host.padEnd(24)} url=${x.e.label.published}  page=${x.declared}` +
          ` (${x.gap > 0 ? '+' : ''}${x.gap}d, ${x.source})`,
      )
      console.log(`      ${x.e.url.slice(0, 96)}`)
    }
  }
}

await main()
