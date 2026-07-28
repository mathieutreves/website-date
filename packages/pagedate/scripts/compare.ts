/**
 * Head-to-head: pagedate vs htmldate on identical inputs.
 *
 *   pnpm --filter pagedate build
 *   python3 scripts/compare_htmldate.py --mode fast      > /tmp/hd-fast.jsonl
 *   python3 scripts/compare_htmldate.py --mode extensive > /tmp/hd-ext.jsonl
 *   node packages/pagedate/scripts/compare.ts
 *
 * Same pages, same gold standard, same metric formulas. This removes "different
 * corpus" as a variable — what remains is a real difference in capability.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'
import { extractFromDocument, resolveCandidates } from '../dist/index.js'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const CORPUS = join(ROOT, 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

type Row = { url: string; file: string; gold: string; found: string | null; ms: number }
type Counts = { exact: number; partial: number; wrong: number; missed: number; ms: number }

const empty = (): Counts => ({ exact: 0, partial: 0, wrong: 0, missed: 0, ms: 0 })

function tally(counts: Counts, gold: string, found: string | null, ms: number): void {
  counts.ms += ms
  if (found === null) counts.missed++
  else if (found === gold) counts.exact++
  // Right but coarser, e.g. `2016-12` against `2016-12-23`. pagedate refuses to
  // invent precision its source did not carry; htmldate always emits a full date.
  else if (gold.startsWith(found)) counts.partial++
  else counts.wrong++
}

function metrics(c: Counts, lenient: boolean) {
  const hits = lenient ? c.exact + c.partial : c.exact
  const wrong = lenient ? c.wrong : c.wrong + c.partial
  const precision = hits + wrong === 0 ? 0 : hits / (hits + wrong)
  const recall = hits + c.missed === 0 ? 0 : hits / (hits + c.missed)
  const total = hits + wrong + c.missed
  return {
    precision,
    recall,
    // tn is structurally zero: every page in this corpus has an identifiable date.
    accuracy: total === 0 ? 0 : hits / total,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  }
}

async function readJsonl(path: string): Promise<Row[] | null> {
  try {
    const text = await readFile(path, 'utf8')
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Row)
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8')) as Record<
    string,
    { file: string; date: string }
  >
  const cached = new Set(await readdir(CACHE))

  const fast = await readJsonl('/tmp/hd-fast.jsonl')
  const extensive = await readJsonl('/tmp/hd-ext.jsonl')
  if (!fast) {
    console.error('missing /tmp/hd-fast.jsonl — run scripts/compare_htmldate.py first')
    process.exit(1)
  }

  const ours = empty()
  const perFile = new Map<string, { gold: string; ours: string | null }>()

  for (const [url, entry] of Object.entries(index)) {
    if (!cached.has(entry.file)) continue
    const html = await readFile(join(CACHE, entry.file), 'utf8')

    const start = performance.now()
    const { document } = parseHTML(html)
    let found: string | null = null
    try {
      const candidates = extractFromDocument(document as unknown as Document, url)
      found = resolveCandidates(candidates, { now: NOW }).published?.value.slice(0, 10) ?? null
    } catch {
      found = null
    }
    // Includes parsing, to match how htmldate is measured — it is handed HTML,
    // not a DOM.
    const ms = performance.now() - start

    tally(ours, entry.date, found, ms)
    perFile.set(entry.file, { gold: entry.date, ours: found })
  }

  const theirs = new Map<string, Counts>()
  for (const [name, rows] of [
    ['htmldate (fast)', fast],
    ['htmldate (extensive)', extensive],
  ] as const) {
    if (!rows) continue
    const counts = empty()
    for (const row of rows) tally(counts, row.gold, row.found, row.ms)
    theirs.set(name, counts)
  }

  const n = perFile.size
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(7)

  console.log(`\nHEAD TO HEAD — ${n} identical pages, publication date only\n`)

  const header =
    '  library                exact  part  wrong  miss | precision  recall  accuracy  F-score   ms/page'
  console.log(header)
  console.log(`  ${'-'.repeat(header.length - 2)}`)

  const rows: Array<[string, Counts]> = [['pagedate', ours], ...theirs]
  for (const [name, c] of rows) {
    const m = metrics(c, false)
    console.log(
      `  ${name.padEnd(22)} ${String(c.exact).padStart(4)}  ${String(c.partial).padStart(4)}  ` +
        `${String(c.wrong).padStart(5)}  ${String(c.missed).padStart(4)} | ` +
        `${pct(m.precision)}  ${pct(m.recall)}  ${pct(m.accuracy)}  ${pct(m.f1)}  ` +
        `${(c.ms / n).toFixed(2).padStart(8)}`,
    )
  }

  console.log('\n  same, counting a coarser-but-consistent answer as correct:')
  for (const [name, c] of rows) {
    const m = metrics(c, true)
    console.log(
      `  ${name.padEnd(22)} ${' '.repeat(25)}| ${pct(m.precision)}  ${pct(m.recall)}  ${pct(m.accuracy)}  ${pct(m.f1)}`,
    )
  }

  // Where each tool is alone in being right is more actionable than the totals.
  if (extensive) {
    const theirBest = new Map(extensive.map((r) => [r.file, r.found]))
    let weWinOnly = 0
    let theyWinOnly = 0
    const theirWins: string[] = []

    for (const [file, { gold, ours: mine }] of perFile) {
      const hd = theirBest.get(file) ?? null
      const meRight = mine === gold
      const themRight = hd === gold
      if (meRight && !themRight) weWinOnly++
      if (themRight && !meRight) {
        theyWinOnly++
        if (theirWins.length < 10) theirWins.push(`    ${gold}  ${file}`)
      }
    }

    console.log(`\n  only pagedate correct:  ${weWinOnly}`)
    console.log(`  only htmldate correct:  ${theyWinOnly}`)
    if (theirWins.length > 0) {
      console.log('\n  pages htmldate gets and we do not (the work queue):')
      console.log(theirWins.join('\n'))
    }
  }

  console.log(`
  NOTES
  ${'-'.repeat(72)}
  * 55 pages, not the 1000 of htmldate's published table — only their cached
    subset is public. Small n: one page is ~1.8 points.
  * Corpus is German-heavy news and blogs, htmldate's home turf, and nothing
    like the technical-content case pagedate is aimed at.
  * Publication date only. Modified dates, confidence tiers and conflict
    detection are not measured here at all.
  * ms/page includes HTML parsing for both, since htmldate is handed HTML.
    In an extension the browser has already parsed the page, so pagedate's
    real cost there is lower than shown.
`)
}

await main()
