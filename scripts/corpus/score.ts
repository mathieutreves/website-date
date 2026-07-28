/**
 * Score pagedate against the harvested corpus.
 *
 *   node scripts/corpus/score.ts                      # dev split, standard mode
 *   node scripts/corpus/score.ts --mode extensive
 *   node scripts/corpus/score.ts --max-lag 9999       # include drifted captures
 *   node scripts/corpus/score.ts --split test         # ONCE, when you are done tuning
 *
 * Two rules make the number mean something, and both are enforced here rather
 * than left to the caller:
 *
 * **`holdOut` is honoured.** Every entry names the extractor sources that share
 * provenance with its label; those candidates are dropped before ranking. A page
 * labelled from its URL cannot be scored on `url-slug`, or the benchmark is
 * measuring itself.
 *
 * **dev and test are split by host.** Tuning against a corpus and then reporting
 * on it recreates the problem this corpus was built to solve, just at larger
 * scale. The split is by host rather than by page, so a site you tuned on cannot
 * leak familiar templates into the held-out set.
 */

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { readManifest, type CorpusEntry } from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MANIFEST = join(ROOT, 'corpus', 'manifest.jsonl')
const CACHE = join(ROOT, 'corpus', 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

// linkedom and the built library both live under the package, not the root.
const require = createRequire(join(ROOT, 'packages', 'pagedate', 'package.json'))
const { parseHTML } = require('linkedom')
const { extractFromDocument, resolveCandidates } = await import(
  join(ROOT, 'packages', 'pagedate', 'dist', 'index.js')
)

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'standard' },
    split: { type: 'string', default: 'dev' },
    /** Captures long after publication have drifted; see schema.captureLagDays. */
    'max-lag': { type: 'string', default: '30' },
    limit: { type: 'string' },
  },
})

const MAX_LAG = Number(values['max-lag'])

/**
 * Deterministic host-level split, ~1 in 3 to test.
 *
 * Hashing the host means the assignment never moves as the corpus grows: a site
 * added next month lands in the same split it would have landed in today, so
 * "test" cannot quietly absorb sites you have already looked at.
 */
function splitOf(host: string): 'dev' | 'test' {
  const digest = createHash('sha1').update(host).digest()
  return digest[0] % 3 === 0 ? 'test' : 'dev'
}

type Tally = { exact: number; partial: number; wrong: number; missed: number }
const empty = (): Tally => ({ exact: 0, partial: 0, wrong: 0, missed: 0 })

/**
 * Compare at the label's own precision.
 *
 * A month-precision label ("2016-12") is satisfied by any December 2016 answer;
 * scoring it against a full date would punish a correct result. In the other
 * direction pagedate may answer more coarsely than the label — right, but less
 * useful — which is `partial`.
 */
function judge(t: Tally, label: string, found: string | null): keyof Tally {
  if (found === null) return (t.missed++, 'missed')
  const width = Math.min(label.length, found.length)
  if (label.slice(0, width) !== found.slice(0, width)) return (t.wrong++, 'wrong')
  if (found.length >= label.length) return (t.exact++, 'exact')
  return (t.partial++, 'partial')
}

const rate = (n: number, d: number): string => (d === 0 ? '   —  ' : `${((n / d) * 100).toFixed(1)}%`)

function line(name: string, t: Tally): string {
  const n = t.exact + t.partial + t.wrong + t.missed
  const answered = t.exact + t.partial + t.wrong
  return (
    `  ${name.padEnd(26)} ${String(n).padStart(5)} ` +
    `${String(t.exact).padStart(6)} ${String(t.partial).padStart(5)} ` +
    `${String(t.wrong).padStart(6)} ${String(t.missed).padStart(5)} | ` +
    `${rate(t.exact, answered).padStart(8)} ${rate(t.exact, n).padStart(9)}`
  )
}

const HEADER =
  '  stratum                        n  exact  part  wrong  miss | precision  accuracy'

function table(title: string, groups: Map<string, Tally>): void {
  console.log(`\n${title}\n`)
  console.log(HEADER)
  console.log(`  ${'-'.repeat(HEADER.length - 2)}`)
  for (const [name, t] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(line(name, t))
  }
}

const lagBucket = (days: number): string =>
  days <= 1 ? 'lag 0-1d' : days <= 7 ? 'lag 2-7d' : days <= 30 ? 'lag 8-30d' : days <= 365 ? 'lag 31-365d' : 'lag >1y'

async function main(): Promise<void> {
  const all = readManifest(await readFile(MANIFEST, 'utf8'))

  let entries = all.filter((e) => e.fetch && e.label.published)
  const fetched = entries.length
  if (values.split !== 'all') {
    entries = entries.filter((e) => splitOf(e.strata.host) === values.split)
  }
  const beforeLag = entries.length
  entries = entries.filter((e) => e.captureLagDays <= MAX_LAG)
  if (values.limit) entries = entries.slice(0, Number(values.limit))

  console.log(
    `\n${all.length} manifest entries, ${fetched} fetched, ` +
      `${beforeLag} in split "${values.split}", ${entries.length} within lag ${MAX_LAG}d`,
  )
  if (values.split === 'test') {
    console.log(`\n  *** SCORING THE HELD-OUT SPLIT. Do this once, at the end. ***`)
  }

  const overall = empty()
  const byHost = new Map<string, Tally>()
  const byEra = new Map<string, Tally>()
  const byLag = new Map<string, Tally>()
  const winners = new Map<string, number>()
  const missedHosts = new Map<string, number>()

  const bump = (m: Map<string, Tally>, key: string): Tally => {
    const t = m.get(key) ?? empty()
    m.set(key, t)
    return t
  }

  for (const entry of entries) {
    let html: string
    try {
      html = await readFile(join(CACHE, `${entry.id}.html`), 'utf8')
    } catch {
      continue
    }

    const { document } = parseHTML(html)
    // The rule the whole corpus design rests on.
    const candidates = extractFromDocument(document, entry.url, { mode: values.mode }).filter(
      (c: { source: string }) => !entry.holdOut.includes(c.source),
    )
    const published = resolveCandidates(candidates, { now: NOW }).published
    const found = published?.value.slice(0, 10) ?? null

    const outcome = judge(overall, entry.label.published!, found)
    judge(bump(byHost, entry.strata.host), entry.label.published!, found)
    judge(bump(byEra, String(entry.strata.era)), entry.label.published!, found)
    judge(bump(byLag, lagBucket(entry.captureLagDays)), entry.label.published!, found)

    if (outcome === 'exact' && published) {
      winners.set(published.source, (winners.get(published.source) ?? 0) + 1)
    }
    if (outcome === 'missed' || outcome === 'wrong') {
      missedHosts.set(entry.strata.host, (missedHosts.get(entry.strata.host) ?? 0) + 1)
    }
  }

  console.log(`\n=== OVERALL (mode=${values.mode}, split=${values.split}) ===\n`)
  console.log(HEADER)
  console.log(`  ${'-'.repeat(HEADER.length - 2)}`)
  console.log(line('all', overall))

  table('=== BY PUBLICATION ERA ===', byEra)
  table('=== BY CAPTURE LAG ===', byLag)

  // Which signal is carrying the result. If one source dominates, the others are
  // either redundant or broken, and that is worth knowing before optimising.
  console.log(`\n=== WHERE THE CORRECT ANSWERS CAME FROM ===\n`)
  for (const [source, n] of [...winners.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source.padEnd(26)} ${String(n).padStart(5)}`)
  }

  console.log(`\n=== WORST HOSTS (wrong + missed) ===\n`)
  for (const [host, n] of [...missedHosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    const t = byHost.get(host)!
    const total = t.exact + t.partial + t.wrong + t.missed
    console.log(`  ${host.padEnd(30)} ${String(n).padStart(4)} of ${String(total).padStart(4)}`)
  }
}

await main()
