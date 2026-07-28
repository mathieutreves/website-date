/**
 * Run pagedate against htmldate's published evaluation corpus.
 *
 *   pnpm --filter pagedate build
 *   node packages/pagedate/scripts/eval-htmldate.ts [--limit N]
 *
 * Reports the same metric shapes htmldate publishes, so the accuracy columns
 * are directly comparable. Read the caveats printed at the end before putting
 * any of these numbers next to theirs.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
// Parses with the library's own `parseHtml` — node-html-parser, the parser
// `pagedate/node` ships. Measuring through a different one would publish a
// figure that describes nothing anyone runs; see bench/parity.mjs.
import { parseHtml } from '../dist/node/index.js'
import { extractFromDocument, resolveCandidates } from '../dist/index.js'

const CORPUS = join(import.meta.dirname, '..', '..', '..', 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')

type Entry = { file: string; date: string }

const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity

/**
 * htmldate resolves relative to when the page was captured, not now. Several
 * corpus pages are a decade old and some carry dates that postdate their own
 * capture; anchoring "now" to the present keeps the plausibility filter from
 * discarding legitimately old pages.
 */
const NOW = new Date('2026-01-01T00:00:00Z')

async function main(): Promise<void> {
  let index: Record<string, Entry>
  try {
    index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8')) as Record<
      string,
      Entry
    >
  } catch {
    console.error('corpus not found — run: node scripts/fetch-htmldate-corpus.ts')
    process.exit(1)
  }

  const cached = new Set(await readdir(CACHE).catch(() => []))
  const entries = Object.entries(index)
    .filter(([, e]) => cached.has(e.file))
    .slice(0, LIMIT)

  if (entries.length === 0) {
    console.error('no cached pages found — run: node scripts/fetch-htmldate-corpus.ts')
    process.exit(1)
  }

  console.log(`evaluating ${entries.length} pages (of ${Object.keys(index).length} in the index)\n`)

  let tp = 0
  let fp = 0
  let fn = 0
  /**
   * Right but coarser than the gold standard, e.g. `2016-12` against
   * `2016-12-23`. Not an error: this library refuses to invent precision the
   * source did not carry, while htmldate always emits a full date. Scored
   * separately so the choice is visible instead of hidden inside FP.
   */
  let partial = 0
  let totalMs = 0
  let parseMs = 0
  const wrongExamples: string[] = []
  const partialExamples: string[] = []

  for (const [url, entry] of entries) {
    const html = await readFile(join(CACHE, entry.file), 'utf8')

    // Parsing is timed separately: in the extension the browser has already
    // produced the DOM, so parse cost is not part of our real per-page latency.
    const parseStart = performance.now()
    const document = parseHtml(html)
    parseMs += performance.now() - parseStart

    const start = performance.now()
    let published: string | undefined
    try {
      const candidates = extractFromDocument(document as unknown as Document, url)
      published = resolveCandidates(candidates, { now: NOW }).published?.value
    } catch {
      published = undefined
    }
    totalMs += performance.now() - start

    const got = published ? published.slice(0, 10) : null

    if (got === null) {
      fn++
    } else if (got === entry.date) {
      tp++
    } else if (entry.date.startsWith(got)) {
      partial++
      if (partialExamples.length < 4) {
        partialExamples.push(`    ${entry.date} expected, got ${got}  ${url.slice(0, 58)}`)
      }
    } else {
      fp++
      if (wrongExamples.length < 6) {
        wrongExamples.push(`    ${entry.date} expected, got ${got}  ${url.slice(0, 58)}`)
      }
    }
  }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`.padStart(6)

  // tn is structurally zero: every page in this corpus has an identifiable date.
  const scoreWith = (hits: number, misses: number) => {
    const precision = hits + misses === 0 ? 0 : hits / (hits + misses)
    const recall = hits + fn === 0 ? 0 : hits / (hits + fn)
    const total = hits + misses + fn
    return {
      precision,
      recall,
      accuracy: total === 0 ? 0 : hits / total,
      f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    }
  }

  const strict = scoreWith(tp, fp + partial)
  const lenient = scoreWith(tp + partial, fp)

  console.log('  RESULTS (htmldate cached subset, publication date only)')
  console.log('  ' + '-'.repeat(62))
  console.log(`  pages              ${entries.length}`)
  console.log(`  exact / partial    ${tp} / ${partial}`)
  console.log(`  wrong / missed     ${fp} / ${fn}`)
  console.log('')
  console.log('                     precision  recall  accuracy  F-score')
  console.log(
    `  strict             ${pct(strict.precision)}  ${pct(strict.recall)}  ${pct(strict.accuracy)}   ${pct(strict.f1)}`,
  )
  console.log(
    `  precision-lenient  ${pct(lenient.precision)}  ${pct(lenient.recall)}  ${pct(lenient.accuracy)}   ${pct(lenient.f1)}`,
  )
  console.log('')
  console.log('  strict            = a month-precision answer counts as wrong')
  console.log('  precision-lenient = it counts as right if consistent with the gold date')
  console.log('')
  console.log(`  extraction   ${(totalMs / entries.length).toFixed(2)} ms/page`)
  console.log(`  (HTML parse  ${(parseMs / entries.length).toFixed(2)} ms/page — not our cost in a content script)`)

  if (partialExamples.length > 0) {
    console.log('\n  sample partials (right, but coarser)')
    console.log(partialExamples.join('\n'))
  }
  if (wrongExamples.length > 0) {
    console.log('\n  sample genuine disagreements')
    console.log(wrongExamples.join('\n'))
  }

  console.log(`
  CAVEATS — read before comparing to htmldate's published table
  ${'-'.repeat(62)}
  * THIS IS NOT htmldate's PUBLISHED BENCHMARK. Their table covers 1000 pages;
    eval_default.json lists 800, but only ~69 of the cached pages are actually
    in the public repo — the rest 404. This runs on that small subset, which is
    also their unit-test set and therefore biased toward cases they handle.
  * Corpus is German-heavy news and blogs from the BBAW collection. It is
    htmldate's home turf and nothing like the technical-content case this
    library is actually for.
  * Gold standard is a single publication date. Modified dates, confidence
    tiers and conflict detection — the entire point of this library — are
    unmeasured here.
  * Accuracy is tp/(tp+fp+fn): true negatives are structurally impossible
    because every page in the corpus has an identifiable date. A library that
    correctly says "no date here" scores nothing for it.
  * The ms/page figure excludes HTML parsing and is therefore NOT comparable
    to htmldate's relative Time column, which is dominated by lxml.
`)
}

await main()
