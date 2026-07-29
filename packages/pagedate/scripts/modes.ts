/**
 * What each mode costs and what it buys.
 *
 *   pnpm --filter pagedate build
 *   node packages/pagedate/scripts/modes.ts
 *
 * Speed without the matching accuracy number is a half-truth, so both are
 * reported together over the same corpus.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
// Parses with the library's own `parseHtml` — node-html-parser, the parser
// `pagedate/node` ships. Measuring through a different one would publish a
// figure that describes nothing anyone runs; see bench/parity.mjs.
import { parseHtml } from '../dist/node/index.js'
import { extractFromDocument, resolveCandidates, type Mode } from '../dist/index.js'

const CORPUS = join(import.meta.dirname, '..', '..', '..', 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

async function main(): Promise<void> {
  const index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8')) as Record<
    string,
    { file: string; date: string }
  >
  const cached = new Set(await readdir(CACHE))

  const pages: Array<{ url: string; doc: Document; gold: string }> = []
  for (const [url, entry] of Object.entries(index)) {
    if (!cached.has(entry.file)) continue
    const document = parseHtml(await readFile(join(CACHE, entry.file), 'utf8'))
    pages.push({ url, doc: document as unknown as Document, gold: entry.date })
  }

  console.log(`\n${pages.length} pages\n`)
  console.log('  mode        ms/page   exact  partial  wrong  missed   accuracy')
  console.log(`  ${'-'.repeat(62)}`)

  const MODES = ['fast', 'standard', 'extensive'] as Mode[]

  /*
   * Timing three modes that share almost all of their code needs more care than
   * a stopwatch around each one, and getting it wrong is not subtle: a careless
   * harness reports `extensive` as *faster* than `standard`, which cannot be
   * true — extensive is standard plus one more extractor and never does less
   * work.
   *
   * Two things cause that. Warming each mode immediately before its own pass
   * still lets the first mode measured pay to compile the parser adapters, the
   * regex caches and the resolver, with every later mode inheriting the work
   * already done. And measuring each mode once, always in the same order, turns
   * that head start into a permanent bias rather than noise that averages out.
   *
   * So: warm every mode before measuring any, rotate the order each round so no
   * mode is permanently first, and take the median. On 55 pages the bias this
   * removes is larger than the difference being measured.
   */
  const WARMUP_ROUNDS = 5
  const TIMED_ROUNDS = 7

  for (let i = 0; i < WARMUP_ROUNDS; i++) {
    for (const mode of MODES) {
      for (const page of pages) extractFromDocument(page.doc, page.url, { mode })
    }
  }

  const timePass = (mode: Mode): number => {
    const started = performance.now()
    for (const page of pages) {
      resolveCandidates(extractFromDocument(page.doc, page.url, { mode }), { now: NOW })
    }
    return (performance.now() - started) / pages.length
  }

  const timings = new Map<Mode, number[]>(MODES.map((m) => [m, []]))
  for (let round = 0; round < TIMED_ROUNDS; round++) {
    const shift = round % MODES.length
    for (const mode of [...MODES.slice(shift), ...MODES.slice(0, shift)]) {
      timings.get(mode)!.push(timePass(mode))
    }
  }

  for (const mode of MODES) {
    let exact = 0
    let partial = 0
    let wrong = 0
    let missed = 0

    for (const page of pages) {
      const candidates = extractFromDocument(page.doc, page.url, { mode })
      const got = resolveCandidates(candidates, { now: NOW }).published?.value.slice(0, 10) ?? null

      if (got === null) missed++
      else if (got === page.gold) exact++
      else if (page.gold.startsWith(got)) partial++
      else wrong++
    }

    const sorted = timings.get(mode)!.slice().sort((a, b) => a - b)
    const ms = sorted[Math.floor(sorted.length / 2)]!
    const accuracy = ((exact / pages.length) * 100).toFixed(1)

    console.log(
      `  ${mode.padEnd(10)} ${ms.toFixed(2).padStart(7)}  ${String(exact).padStart(6)}  ` +
        `${String(partial).padStart(7)}  ${String(wrong).padStart(5)}  ${String(missed).padStart(6)}  ` +
        `${accuracy.padStart(8)}%`,
    )
  }

  console.log(`
  Timings exclude HTML parsing, which an extension does not pay — the browser
  has already produced the DOM.
`)
}

await main()
