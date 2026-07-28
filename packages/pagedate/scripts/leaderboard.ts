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
import { parseHTML } from 'linkedom'
import { extractFromDocument, resolveCandidates, type Mode } from '../dist/index.js'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const CORPUS = join(ROOT, 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

type Row = { tool: string; file: string; gold: string; found: string | null; ms: number }
type Tally = { exact: number; partial: number; wrong: number; missed: number; ms: number }

const empty = (): Tally => ({ exact: 0, partial: 0, wrong: 0, missed: 0, ms: 0 })

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

  const results = new Map<string, Tally>()

  // Our own numbers, measured here rather than imported.
  const pages: Array<{ url: string; doc: Document; gold: string }> = []
  for (const [url, entry] of Object.entries(index)) {
    if (!cached.has(entry.file)) continue
    const { document } = parseHTML(await readFile(join(CACHE, entry.file), 'utf8'))
    pages.push({ url, doc: document as unknown as Document, gold: entry.date })
  }

  for (const mode of ['fast', 'standard'] as Mode[]) {
    const t = empty()
    for (const page of pages) extractFromDocument(page.doc, page.url, { mode }) // warm-up
    for (const page of pages) {
      const started = performance.now()
      const found =
        resolveCandidates(extractFromDocument(page.doc, page.url, { mode }), { now: NOW }).published
          ?.value.slice(0, 10) ?? null
      tally(t, page.gold, found, performance.now() - started)
    }
    results.set(`pagedate (${mode})`, t)
  }

  for (const path of ['/tmp/bench-python.jsonl', '/tmp/bench-js.jsonl']) {
    for (const row of await readJsonl(path)) {
      const t = results.get(row.tool) ?? empty()
      tally(t, row.gold, row.found, row.ms)
      results.set(row.tool, t)
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
