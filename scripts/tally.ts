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

type Row = { tool: string; file: string; gold: string; found: string | null; ms: number }
type Tally = { exact: number; partial: number; wrong: number; missed: number; ms: number }

const empty = (): Tally => ({ exact: 0, partial: 0, wrong: 0, missed: 0, ms: 0 })

/**
 * Compare at the label's own precision.
 *
 * A month-precision label is satisfied by any answer inside that month; scoring
 * it against a full date would punish a correct result. In the other direction a
 * coarser-but-consistent answer is `partial` — right, but less useful. Only
 * pagedate produces those, because it refuses to invent precision its source did
 * not carry while every other tool here always emits a full date.
 */
function judge(t: Tally, gold: string, found: string | null): void {
  if (found === null) return void t.missed++
  const width = Math.min(gold.length, found.length)
  if (gold.slice(0, width) !== found.slice(0, width)) return void t.wrong++
  if (found.length >= gold.length) return void t.exact++
  return void t.partial++
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    console.error('usage: node scripts/tally.ts <bench-output.jsonl>...')
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
      judge(t, row.gold, row.found)
      t.ms += row.ms
      tools.set(row.tool, t)
      pages.add(row.file)
    }
  }

  const n = pages.size
  const pct = (v: number, d: number): string =>
    d === 0 ? '     — ' : `${((v / d) * 100).toFixed(1)}%`.padStart(7)

  const header =
    '  tool                            exact  part  wrong  miss | precision  accuracy   ms/page'
  console.log(`\n${n} pages\n`)
  console.log(header)
  console.log(`  ${'-'.repeat(header.length - 2)}`)

  const rows = [...tools.entries()].sort((a, b) => b[1].exact - a[1].exact)
  for (const [name, t] of rows) {
    const total = t.exact + t.partial + t.wrong + t.missed
    const answered = t.exact + t.partial + t.wrong
    console.log(
      `  ${(name.startsWith('pagedate') ? '▸ ' : '  ') + name.padEnd(29)} ` +
        `${String(t.exact).padStart(4)}  ${String(t.partial).padStart(4)}  ` +
        `${String(t.wrong).padStart(5)}  ${String(t.missed).padStart(4)} | ` +
        `${pct(t.exact, answered)}  ${pct(t.exact, total)}  ` +
        `${(t.ms / Math.max(1, total)).toFixed(2).padStart(8)}`,
    )
  }

  console.log(`
  precision = of the pages a tool answered, how many it got right
  accuracy  = of all pages, how many it got right
  A tool that refuses to guess scores well on the first and badly on the second;
  the two together are the only honest summary of one.
`)
}

await main()
