/**
 * Render any bench harness's per-page JSONL into a table.
 *
 *   node scripts/tally.ts results/permalink-python.jsonl
 *   node scripts/tally.ts results/*.jsonl
 *
 * The harnesses emit one `{tool, file, gold, found, ms}` line per page and stop
 * there, deliberately: the raw rows are what someone checking these results
 * needs, and a harness that only printed a summary would make every claim
 * unfalsifiable. This turns them into the table.
 */

import { readFile } from 'node:fs/promises'

type Row = { tool: string; file: string; gold: string | null; found: string | null; ms: number }
type Tally = {
  exact: number
  partial: number
  wrong: number
  missed: number
  /** Negative page, nothing returned — correct. */
  tn: number
  /** Negative page, a date returned — invented. */
  fp: number
  ms: number
}

const empty = (): Tally => ({ exact: 0, partial: 0, wrong: 0, missed: 0, tn: 0, fp: 0, ms: 0 })

/**
 * Compare at the label's own precision.
 *
 * A month-precision label is satisfied by any answer inside that month; scoring
 * it against a full date would punish a correct result. In the other direction a
 * coarser-but-consistent answer is `partial` — right, but less useful. Only
 * pagedate produces those, because it refuses to invent precision its source did
 * not carry while every other tool here always emits a full date.
 *
 * A `gold` of null is a page with no publication date. There, returning nothing
 * is the right answer and any date is a false positive — the one cell that lets
 * a table distinguish a tool which knows when to stop from one that always
 * answers.
 */
function judge(t: Tally, gold: string | null, found: string | null, toleranceDays = 0): void {
  if (gold === null) return void (found === null ? t.tn++ : t.fp++)
  if (found === null) return void t.missed++
  const width = Math.min(gold.length, found.length)
  if (gold.slice(0, width) !== found.slice(0, width)) {
    // Within tolerance counts as exact, and only for full dates: sliding a
    // month-precision label by a day means nothing.
    //
    // Applied here rather than in any single harness because it has to apply to
    // *every* tool from the same rows. `score.ts` has had a `--tolerance` flag
    // for a while and `score.ts` scores pagedate alone, so the ±1 day figures
    // that flag produces have never been computed for a competitor. Quoting one
    // beside another tool's strict number would be comparing a lenient measure
    // of ourselves against a strict measure of everyone else.
    if (toleranceDays > 0 && gold.length === 10 && found.length >= 10) {
      const gap = Math.abs(Date.parse(found.slice(0, 10)) - Date.parse(gold)) / 86_400_000
      if (Number.isFinite(gap) && gap <= toleranceDays) return void t.exact++
    }
    return void t.wrong++
  }
  if (found.length >= gold.length) return void t.exact++
  return void t.partial++
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  // `--tolerance N` applies to every tool in the rows, never to one of them.
  let tolerance = 0
  const paths: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--tolerance') tolerance = Number(argv[++i] ?? 0)
    else if (arg.startsWith('--tolerance=')) tolerance = Number(arg.slice(12))
    else paths.push(arg)
  }
  if (paths.length === 0) {
    console.error('usage: node scripts/tally.ts [--tolerance N] <bench-output.jsonl>...')
    process.exit(2)
  }

  const tools = new Map<string, Tally>()
  const pages = new Set<string>()

  for (const path of paths) {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      console.error(`skip ${path}: not readable`)
      continue
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const row = JSON.parse(line) as Row
      const t = tools.get(row.tool) ?? empty()
      judge(t, row.gold, row.found, tolerance)
      t.ms += row.ms
      tools.set(row.tool, t)
      pages.add(row.file)
    }
  }

  const n = pages.size
  const pct = (v: number, d: number): string =>
    d === 0 ? '     — ' : `${((v / d) * 100).toFixed(1)}%`.padStart(7)

  const anyNegatives = [...tools.values()].some((t) => t.tn + t.fp > 0)
  const header =
    '  tool                            exact  part  wrong  miss    TN   FP | precision  accuracy  useful   ms/page'
  const negN = anyNegatives ? [...tools.values()][0].tn + [...tools.values()][0].fp : 0
  console.log(`\n${n} pages${anyNegatives ? ` (${n - negN} dated, ${negN} with no date)` : ''}\n`)
  console.log(header)
  console.log(`  ${'-'.repeat(header.length - 2)}`)

  // Ranked on exact + tn, so declining correctly counts as getting a page right.
  const rows = [...tools.entries()].sort((a, b) => b[1].exact + b[1].tn - (a[1].exact + a[1].tn))
  for (const [name, t] of rows) {
    const total = t.exact + t.partial + t.wrong + t.missed + t.tn + t.fp
    const answered = t.exact + t.partial + t.wrong + t.fp
    console.log(
      `  ${(name.startsWith('pagedate') ? '▸ ' : '  ') + name.padEnd(29)} ` +
        `${String(t.exact).padStart(4)}  ${String(t.partial).padStart(4)}  ` +
        `${String(t.wrong).padStart(5)}  ${String(t.missed).padStart(4)}  ` +
        `${String(t.tn).padStart(4)} ${String(t.fp).padStart(4)} | ` +
        `${pct(t.exact, answered)}  ${pct(t.exact + t.tn, total)}  ` +
        `${pct(t.exact + t.tn + t.partial, total)}  ` +
        `${(t.ms / Math.max(1, total)).toFixed(2).padStart(8)}`,
    )
  }

  console.log(`
  precision = of the pages a tool answered, how many it got right — an invented
              date on an undated page (FP) counts against it exactly as a wrong
              date does
  accuracy  = of all pages, how many it got right, counting a correct refusal (TN)
  useful    = accuracy, plus answers correct at a coarser precision than the
              label (part) — "2015" against a 2015-06-12 label is true, and is
              not the same event as finding nothing. No competitor here can
              score a "part": none of them will emit "2015" rather than an
              invented "2015-01-01", so their two rates are equal by
              construction, which is the difference being shown
  ${
    anyNegatives
      ? 'TN/FP are the pages with no publication date. They are the only cells that\n  can charge a tool for answering when it should not have.'
      : 'No page in this run lacks a date, so TN and FP are structurally zero and\n  declining to answer can only lose points. Read precision with that in mind.'
  }
`)
}

await main()
