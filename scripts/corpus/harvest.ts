/**
 * Harvest date-permalink pages into a corpus manifest.
 *
 *   node scripts/corpus/harvest.ts                       # uses scripts/corpus/seeds.txt
 *   node scripts/corpus/harvest.ts --per-domain 100
 *   node scripts/corpus/harvest.ts --seeds my-domains.txt --allow-month
 *
 * One CDX query per domain does the whole job: it returns URLs matching a
 * date-permalink shape *and* the earliest archived capture of each, so the label
 * and the snapshot pin come from the same request. Wayback is doing the crawling
 * that would otherwise take weeks.
 *
 * Resumable — domains already represented in the manifest are skipped, so this
 * can be interrupted and re-run.
 *
 * Politeness matters here: CDX is a free service with no SLA, and a benchmark
 * that gets the project blocked from the Internet Archive is a bad trade.
 * Concurrency is deliberately low and 429/503 backs off rather than retrying
 * hard.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  archiveUrl,
  entryId,
  labelPrecedesCapture,
  parsePermalinkDate,
  readManifest,
  snapshotDay,
  writeFileAtomic,
  writeManifest,
  type CorpusEntry,
} from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const OUT_DIR = join(ROOT, 'corpus')
const MANIFEST = join(OUT_DIR, 'manifest.jsonl')
const STATE = join(OUT_DIR, 'harvested-seeds.txt')
const USER_AGENT =
  'pagedate-corpus/0.1 (benchmark corpus construction; +https://github.com/mathieutreves/website-date)'

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: join(import.meta.dirname, 'seeds.txt') },
    'per-domain': { type: 'string', default: '60' },
    concurrency: { type: 'string', default: '3' },
    'allow-month': { type: 'boolean', default: false },
  },
})

const PER_DOMAIN = Number(values['per-domain'])
const CONCURRENCY = Number(values.concurrency)
const ALLOW_MONTH = values['allow-month']

/**
 * Rows to pull per era before sampling down.
 *
 * CDX sorts by URL key, so a single capped query returns an alphabetically
 * clustered slice — for a date-permalink site that means the earliest years and
 * nothing else. Over-fetching within an era and striding spreads the sample
 * across the sections of a site.
 */
const OVERSAMPLE = 12

/**
 * Rows to pull for a single (site, year, month) before striding down to quota.
 *
 * A month of one site is small enough that this spans it comfortably even for a
 * daily publisher, so the stride samples across the whole month rather than its
 * first few days.
 */
const MONTH_WINDOW = 1500

/**
 * Publication years to sample, spread across the lifetime of the web.
 *
 * Sampling by year is what keeps the corpus from collapsing into one era: CDX
 * sorts by URL key, so an unrestricted query on a date-permalink site returns
 * its earliest years and nothing else. Markup from 2008 breaks parsers in ways
 * markup from 2024 does not, and a corpus that silently covers only one is not
 * measuring generality.
 */
const YEARS = [2006, 2009, 2012, 2015, 2018, 2021, 2023, 2025]

/**
 * (year, month) pairs to sample, two per year, rotating through the calendar.
 *
 * Sampling by year alone is not enough. `/2015/01/…` sorts before `/2015/12/…`,
 * so on a site that publishes daily even a wide per-year window never reaches
 * February — a measured run over eight years returned pages from three distinct
 * months. Querying a month at a time makes each request a small index range,
 * which is both faster and immune to that.
 *
 * The rotation (`i * 5`) walks the months across years rather than sampling the
 * same season repeatedly, so seasonal markup changes cannot masquerade as an
 * era effect.
 */
const SAMPLE_POINTS: Array<{ year: number; month: number }> = YEARS.flatMap((year, i) => [
  { year, month: ((i * 5) % 12) + 1 },
  { year, month: ((i * 5 + 6) % 12) + 1 },
])

/**
 * A failed query is not an empty one.
 *
 * CDX answers a whole-domain regex scan of a large site with a 504, which is
 * indistinguishable from an empty result unless the distinction is kept. Folding
 * a non-OK response into "no matches" silently produces a corpus missing whole
 * eras while reporting success, so failures are counted and printed at the end.
 */
type QueryOutcome = { rows: CdxRow[]; failed: boolean }

type CdxRow = string[]

/**
 * One query per (site, year), as a **prefix** match.
 *
 * `url=example.com/2015&matchType=prefix` resolves to a contiguous range of the
 * CDX index, because the index is sorted by URL key. The obvious alternative —
 * `matchType=domain` with a regex filter for the year — makes the server scan
 * every capture the domain has and times out on anything large.
 *
 * The cost is that only dates in the *first* path segment are found. A site that
 * publishes to `/blog/2015/08/05/` needs its seed written as `example.com/blog`,
 * which seeds.txt supports.
 */
async function cdx(prefix: string, path: string, limit: number): Promise<QueryOutcome> {
  const url = new URL('https://web.archive.org/cdx/search/cdx')
  url.searchParams.set('url', `${prefix}/${path}`)
  url.searchParams.set('matchType', 'prefix')
  url.searchParams.set('output', 'json')
  url.searchParams.set('collapse', 'urlkey') // earliest capture per URL
  url.searchParams.set('fl', 'original,timestamp,statuscode,mimetype,digest,length')
  url.searchParams.set('limit', String(limit))
  url.searchParams.append('filter', 'statuscode:200')
  url.searchParams.append('filter', 'mimetype:text/html')

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(120_000),
      })
      // 504 belongs here too: the Archive returns it for queries it could not
      // finish, and those are exactly the ones worth retrying more slowly.
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 3) {
          console.error(`  ${prefix}/${path}: ${response.status} after 4 tries`)
          return { rows: [], failed: true }
        }
        await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt))
        continue
      }
      if (!response.ok) return { rows: [], failed: true }
      const text = await response.text()
      if (!text.trim()) return { rows: [], failed: false } // genuinely no matches
      const rows = JSON.parse(text) as CdxRow[]
      return { rows: rows.slice(1), failed: false } // drop the header row
    } catch (error) {
      if (attempt === 3) {
        console.error(`  ${prefix}/${path}: ${(error as Error).message}`)
        return { rows: [], failed: true }
      }
      await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt))
    }
  }
  return { rows: [], failed: true }
}

/**
 * Even stride through the matches, so one section of a site cannot dominate.
 *
 * `phase` shifts where in the range sampling starts. Without it every call takes
 * index 0, and since CDX sorts by URL key that is the 1st of the month, every
 * time — a harvest with the year and month spread already fixed still comes back
 * 27 labels in 28 dated the 1st. Varying the phase per sample point spreads the
 * day of month too, and keeps the choice deterministic so a rebuild is identical.
 */
function stride<T>(items: T[], want: number, phase = 0): T[] {
  if (items.length === 0) return []
  if (items.length <= want) return items
  const step = items.length / want
  const out: T[] = []
  for (let i = 0; i < want; i++) {
    out.push(items[Math.floor((i + phase) * step) % items.length])
  }
  return out
}

function toEntry(row: CdxRow, allowMonth: boolean): CorpusEntry | null {
  const [original, timestamp, statuscode, mimetype, digest, length] = row
  const label = parsePermalinkDate(original, allowMonth)
  if (!label) return null

  // The one free sanity check on an auto-generated label.
  if (!labelPrecedesCapture(label.published, timestamp)) return null

  let host: string
  try {
    host = new URL(original).hostname.replace(/^www\./, '')
  } catch {
    return null
  }

  const lagMs =
    Date.parse(`${snapshotDay(timestamp)}T00:00:00Z`) -
    Date.parse(`${label.published.padEnd(10, '-01')}T00:00:00Z`)

  return {
    id: entryId(original),
    url: original,
    snapshot: timestamp,
    archiveUrl: archiveUrl(timestamp, original),
    captureLagDays: Math.round(lagMs / 86_400_000),
    label: {
      published: label.published,
      precision: label.precision,
      source: 'url-permalink',
      tier: 'silver',
      evidence: label.evidence,
    },
    // The whole point of the permalink source: it is independent of every
    // markup channel, but obviously not of the one that reads the URL.
    holdOut: ['url-slug'],
    strata: {
      host,
      tld: host.slice(host.lastIndexOf('.') + 1),
      era: Number(label.published.slice(0, 4)) || null,
    },
    http: {
      status: Number(statuscode),
      mime: mimetype,
      digest,
      length: Number(length) || 0,
    },
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })

  const seedText = await readFile(values.seeds!, 'utf8')
  const domains = seedText
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)

  let existing: CorpusEntry[] = []
  try {
    existing = readManifest(await readFile(MANIFEST, 'utf8'))
  } catch {
    /* first run */
  }

  /**
   * Seeds already attempted, appended one per line as each finishes.
   *
   * Resuming cannot be decided from the manifest alone: a seed that legitimately
   * yields nothing — a site using month-precision permalinks, say — has no
   * entries to look for, so it would be re-queried in full on every resume.
   * Append-only, so a kill mid-run loses at most the seed in flight.
   */
  let attempted = new Set<string>()
  try {
    attempted = new Set(
      (await readFile(STATE, 'utf8')).split('\n').map((line) => line.trim()).filter(Boolean),
    )
  } catch {
    /* first run */
  }

  const seenUrls = new Set(existing.map((e) => e.url))
  const todo = domains.filter((d) => !attempted.has(d))

  console.log(
    `${domains.length} seed domains, ${todo.length} still to harvest` +
      ` (${existing.length} entries already in the manifest)`,
  )

  const collected: CorpusEntry[] = []
  let index = 0
  let queryFailures = 0

  const worker = async (): Promise<void> => {
    while (index < todo.length) {
      const prefix = todo[index++]

      // The per-domain quota is split evenly across sample points, so a site
      // that published heavily in one period cannot crowd out the others.
      const quota = Math.max(1, Math.round(PER_DOMAIN / SAMPLE_POINTS.length))
      const kept: CorpusEntry[] = []
      const perYear = new Map<number, number>()
      let failures = 0

      for (const [pointIndex, point] of SAMPLE_POINTS.entries()) {
        const window = Math.max(MONTH_WINDOW, quota * OVERSAMPLE)
        const padded = String(point.month).padStart(2, '0')

        let { rows, failed } = await cdx(prefix, `${point.year}/${padded}`, window)
        // Most CMSs zero-pad the month, but not all — `/2015/7/` is a real and
        // reasonably common permalink shape, and querying only the padded form
        // would silently return nothing for those sites.
        if (!failed && rows.length === 0 && point.month < 10) {
          ;({ rows, failed } = await cdx(prefix, `${point.year}/${point.month}`, window))
        }

        if (failed) {
          failures++
          queryFailures++
          continue
        }

        const entries: CorpusEntry[] = []
        for (const row of rows) {
          const entry = toEntry(row, ALLOW_MONTH)
          if (!entry) continue
          if (seenUrls.has(entry.url)) continue
          seenUrls.add(entry.url)
          entries.push(entry)
        }

        // An irrational-ish step keeps consecutive sample points from landing on
        // the same relative offset within their month.
        const sampled = stride(entries, quota, (pointIndex * 0.618) % 1)
        kept.push(...sampled)
        perYear.set(point.year, (perYear.get(point.year) ?? 0) + sampled.length)
      }

      collected.push(...kept)
      const spread = YEARS.map((y) => `${y}:${perYear.get(y) ?? 0}`).join(' ')
      console.log(
        `  ${prefix.padEnd(24)} ${String(kept.length).padStart(3)} kept` +
          `${failures ? `  (${failures} FAILED)` : ''}   ${spread}`,
      )

      // Written incrementally and atomically: a long harvest that dies partway
      // should lose at most the seed in flight, and never a truncated manifest.
      await writeFileAtomic(MANIFEST, writeManifest([...existing, ...collected]))
      // Only a seed whose queries all succeeded counts as attempted. Marking a
      // seed done when CDX timed out on half its cells would make the promised
      // "re-run to retry" a no-op, and bake the gap in permanently. Re-running a
      // partially harvested seed is safe: URLs already in the manifest are
      // deduplicated.
      if (failures === 0) await appendFile(STATE, `${prefix}\n`)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const all = [...existing, ...collected]
  const hosts = new Set(all.map((e) => e.strata.host))
  const byYear = new Map<number | null, number>()
  for (const entry of all) byYear.set(entry.strata.era, (byYear.get(entry.strata.era) ?? 0) + 1)

  console.log(`\n${all.length} entries across ${hosts.size} hosts → corpus/manifest.jsonl`)
  console.log(
    `  by year: ${[...byYear.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([year, n]) => `${year}:${n}`)
      .join(' ')}`,
  )
  // Stated rather than swallowed: a failed query is a hole in the sample, and a
  // corpus with unreported holes is worse than a smaller honest one.
  if (queryFailures) {
    console.log(`\n  ${queryFailures} CDX queries FAILED — those (site, year) cells are missing.`)
    console.log(`  Re-run to retry them, or the corpus is biased against whatever they held.`)
  }
  console.log(`\nnext: node scripts/corpus/fetch.ts`)
}

await main()
