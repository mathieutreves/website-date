/**
 * Every tool, same pages, same metric, current versions.
 *
 *   python3 scripts/bench_python.py > /tmp/bench-python.jsonl
 *   node bench/bench_js.mjs         > /tmp/bench-js.jsonl
 *   pnpm --filter pagedate build
 *   node packages/pagedate/scripts/leaderboard.ts
 *
 * Run rather than cited, because a published table is a snapshot: versions move
 * on, and a tool that scored well years ago may since have broken.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
// Parses with the library's own `parseHtml` — node-html-parser, the parser
// `pagedate/node` ships. Measuring through a different one would publish a
// figure that describes nothing anyone runs; see bench/parity.mjs.
import { parseHtml } from '../dist/node/index.js'
import { extractFromDocument, resolveCandidates, type Mode } from '../dist/index.js'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const CORPUS = join(ROOT, 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

type Row = { tool: string; file: string; gold: string; found: string | null; ms: number }
type Tally = { exact: number; partial: number; wrong: number; missed: number; ms: number }

const empty = (): Tally => ({ exact: 0, partial: 0, wrong: 0, missed: 0, ms: 0 })

type Correction = { gold: string; corrected: string | null; kind: string; reason: string }

/**
 * Gold entries judged wrong, loaded from corpus-external/corrections.json.
 *
 * Scored as a *second* table beside the original, never instead of it. Editing
 * an answer key in place and reporting one number is how a benchmark author
 * measures nothing; showing both is how a reader can disagree.
 */
async function loadCorrections(): Promise<Record<string, Correction>> {
  try {
    const raw = await readFile(join(ROOT, 'corpus-external', 'corrections.json'), 'utf8')
    return (JSON.parse(raw) as { corrections: Record<string, Correction> }).corrections
  } catch {
    return {}
  }
}

function tally(t: Tally, gold: string, found: string | null, ms: number): void {
  t.ms += ms
  if (found === null) t.missed++
  else if (found === gold) t.exact++
  // Right but coarser. pagedate refuses to invent precision its source did not
  // carry; every other tool here always emits a full date.
  else if (gold.startsWith(found)) t.partial++
  else t.wrong++
}

function score(t: Tally) {
  const hits = t.exact
  const wrong = t.wrong + t.partial
  const precision = hits + wrong === 0 ? 0 : hits / (hits + wrong)
  const recall = hits + t.missed === 0 ? 0 : hits / (hits + t.missed)
  const total = hits + wrong + t.missed
  return {
    precision,
    recall,
    // tn is structurally zero: every page in this corpus has an identifiable date.
    accuracy: total === 0 ? 0 : hits / total,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  }
}

async function readJsonl(path: string): Promise<Row[]> {
  try {
    const text = await readFile(path, 'utf8')
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Row)
  } catch {
    return []
  }
}

async function main(): Promise<void> {
  const index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8')) as Record<
    string,
    { file: string; date: string }
  >
  const cached = new Set(await readdir(CACHE))

  const corrections = await loadCorrections()
  const results = new Map<string, Tally>()
  const corrected = new Map<string, Tally>()

  /**
   * Score one answer against the corrected key.
   *
   * Applied symmetrically: where the corrected answer is null the page has no
   * publication date, so *any* date is wrong — pagedate's included.
   */
  const tallyCorrected = (tool: string, file: string, gold: string, found: string | null, ms: number) => {
    const t = corrected.get(tool) ?? empty()
    const fix = corrections[file]
    if (!fix) tally(t, gold, found, ms)
    else if (fix.corrected === null) {
      t.ms += ms
      if (found === null) t.exact++
      else t.wrong++
    } else tally(t, fix.corrected, found, ms)
    corrected.set(tool, t)
  }

  // Our own numbers, measured here rather than imported.
  const pages: Array<{ url: string; doc: Document; gold: string; file: string }> = []
  for (const [url, entry] of Object.entries(index)) {
    if (!cached.has(entry.file)) continue
    const document = parseHtml(await readFile(join(CACHE, entry.file), 'utf8'))
    pages.push({ url, doc: document as unknown as Document, gold: entry.date, file: entry.file })
  }

  for (const mode of ['fast', 'standard'] as Mode[]) {
    const t = empty()
    for (const page of pages) extractFromDocument(page.doc, page.url, { mode }) // warm-up
    for (const page of pages) {
      const started = performance.now()
      const found =
        resolveCandidates(extractFromDocument(page.doc, page.url, { mode }), { now: NOW }).published
          ?.value.slice(0, 10) ?? null
      const ms = performance.now() - started
      tally(t, page.gold, found, ms)
      tallyCorrected(`pagedate (${mode})`, page.file, page.gold, found, ms)
    }
    results.set(`pagedate (${mode})`, t)
  }

  // Paths may be given as arguments so scripts/validate.sh can keep its outputs
  // in results/ rather than /tmp, where they would be lost between runs and
  // could not be committed alongside the tables they produced.
  const inputs =
    process.argv.length > 2 ? process.argv.slice(2) : ['/tmp/bench-python.jsonl', '/tmp/bench-js.jsonl']

  for (const path of inputs) {
    for (const row of await readJsonl(path)) {
      const t = results.get(row.tool) ?? empty()
      tally(t, row.gold, row.found, row.ms)
      results.set(row.tool, t)
      tallyCorrected(row.tool, row.file, row.gold, row.found, row.ms)
    }
  }

  const n = pages.length
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(7)

  console.log(`\nSAME ${n} PAGES, SAME METRIC, CURRENT VERSIONS — publication date only\n`)
  const header =
    '  tool                            exact  part  wrong  miss | precision  recall  accuracy  F-score   ms/page'
  console.log(header)
  console.log(`  ${'-'.repeat(header.length - 2)}`)

  const rows = [...results.entries()].sort((a, b) => score(b[1]).accuracy - score(a[1]).accuracy)

  for (const [name, t] of rows) {
    const s = score(t)
    const mine = name.startsWith('pagedate')
    console.log(
      `  ${(mine ? '▸ ' : '  ') + name.padEnd(29)} ${String(t.exact).padStart(4)}  ` +
        `${String(t.partial).padStart(4)}  ${String(t.wrong).padStart(5)}  ${String(t.missed).padStart(4)} | ` +
        `${pct(s.precision)}  ${pct(s.recall)}  ${pct(s.accuracy)}  ${pct(s.f1)}  ` +
        `${(t.ms / n).toFixed(2).padStart(8)}`,
    )
  }

  // Second table: same runs, corrected answer key.
  const fixCount = Object.keys(corrections).length
  if (fixCount > 0) {
    console.log(`\n\n  SAME RUNS, ${fixCount} GOLD ENTRIES CORRECTED (see corpus-external/corrections.json)\n`)
    console.log(header)
    console.log(`  ${'-'.repeat(header.length - 2)}`)
    const fixedRows = [...corrected.entries()].sort((a, b) => score(b[1]).accuracy - score(a[1]).accuracy)
    for (const [name, t] of fixedRows) {
      const s2 = score(t)
      const mine = name.startsWith('pagedate')
      const before = results.get(name)
      const delta = before ? (s2.accuracy - score(before).accuracy) * 100 : 0
      console.log(
        `  ${(mine ? '▸ ' : '  ') + name.padEnd(29)} ${String(t.exact).padStart(4)}  ` +
          `${String(t.partial).padStart(4)}  ${String(t.wrong).padStart(5)}  ${String(t.missed).padStart(4)} | ` +
          `${pct(s2.precision)}  ${pct(s2.recall)}  ${pct(s2.accuracy)}  ${pct(s2.f1)}  ` +
          `${(delta >= 0 ? '+' : '') + delta.toFixed(1)}pt`.padStart(9),
      )
    }
  }

  console.log(`
  * "part" is a coarser-but-consistent answer, e.g. 2016-12 against 2016-12-23,
    and is scored as wrong above. Only pagedate produces these: it refuses to
    invent precision its source did not carry, while every other tool here
    always emits a full date.
  * Python timings include lxml parsing; pagedate's exclude HTML parsing, which
    an extension does not pay. They are not comparable to each other.
  * ${n} pages, not the 1000 of htmldate's published table — only their cached
    subset is public. German-heavy news and blogs. See docs/CORPUS-NOTES.md for
    gold-standard caveats.
`)
}

await main()
