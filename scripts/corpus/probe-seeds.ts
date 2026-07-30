/**
 * Turn a ranked domain list into a seed file, mechanically.
 *
 *   node scripts/corpus/probe-seeds.ts --list tranco.csv --top 2500
 *   node scripts/corpus/probe-seeds.ts --list tranco.csv --top 2500 --out corpus/seeds-tranco.txt
 *
 * `seeds.txt` was hand-written, and a hand-written seed list samples the sites
 * its author thought of. That is the one bias in this corpus that cannot be
 * argued away by any amount of careful labelling, because it decides which
 * pages exist to be labelled at all. This script replaces the judgement with a
 * published frame plus a mechanical test.
 *
 * **The frame is Tranco.** A daily, citable, reproducible ranking built from
 * five independent providers, with a list id that pins exactly which ranking was
 * used. Nobody involved in this project chose its members. It is the head of the
 * web rather than a sample of the whole of it — that skew is real and stated in
 * CORPUS-BUILD.md — but it is a skew a reader can see and reason about, which a
 * list of "sites I thought of" is not.
 *
 * **The test is whether Wayback holds date-permalink URLs for the host**, which
 * is the same predicate `harvest.ts` applies, run through the same
 * `parsePermalinkDate`. A domain is not judged on whether it looks like a
 * publisher; it is judged on whether the label source this corpus depends on
 * actually exists there.
 *
 * ## Why the probe is `<domain>/20`
 *
 * CDX is sorted by URL key, so a prefix query resolves to a contiguous index
 * range and answers fast. `/20` is the shortest prefix that covers every year
 * from 2000 to 2099 in one range, so a single query decides the common case.
 * The alternative — `matchType=domain` with a regex filter for date-shaped
 * paths — makes the Archive scan every capture a domain has and answers large
 * sites with a 504, which is exactly the failure `harvest.ts` documents.
 *
 * The cost of prefix matching is that it only sees dates in the **first** path
 * segment. `nrc.nl` publishes to `/nieuws/2015/06/01/…` and is invisible to a
 * probe of the bare host. So a domain that misses is retried under two section
 * prefixes before being rejected. Two rather than ten: each is a query against a
 * free service, most domains in a Tranco slice are infrastructure that will
 * never match under any prefix, and the pair below covers the overwhelming
 * majority of sites that section their archive at all. Sites using a third shape
 * are missed, and that is a known hole rather than a silent one — it is printed
 * in the summary and recorded in the reject log.
 *
 * ## What it does not do
 *
 * It does not look at the pages. A host passes here on the existence of
 * date-shaped permalinks with plausible labels, and nothing more; whether those
 * pages are articles, whether the label agrees with the document, and whether
 * the capture drifted are all decided later by `harvest.ts`, `enrich.ts` and the
 * capture-lag filter. This stage exists to stop the corpus being a list of
 * somebody's bookmarks, not to replace the checks downstream of it.
 */

import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { labelPrecedesCapture, parsePermalinkDate } from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const USER_AGENT =
  'pagedate-corpus/0.1 (benchmark corpus construction; +https://github.com/mathieutreves/website-date)'

const { values } = parseArgs({
  options: {
    list: { type: 'string' },
    top: { type: 'string', default: '2500' },
    out: { type: 'string', default: join(ROOT, 'corpus', 'seeds-tranco.txt') },
    /** Append-only record of every domain decided, so a kill mid-run resumes. */
    state: { type: 'string', default: join(ROOT, 'corpus', 'probed-domains.txt') },
    rejects: { type: 'string', default: join(ROOT, 'corpus', 'probed-rejects.txt') },
    concurrency: { type: 'string', default: '4' },
    /**
     * Distinct valid permalinks a prefix must yield to be seeded.
     *
     * One hit is noise: a marketing site with a single `/2019/annual-report/`
     * page matches the pattern and yields nothing harvestable. Four is low
     * enough to keep small blogs, which are the part of the corpus most at risk
     * of being squeezed out by a head-of-the-web frame.
     */
    'min-hits': { type: 'string', default: '4' },
  },
})

const TOP = Number(values.top)
const CONCURRENCY = Number(values.concurrency)
const MIN_HITS = Number(values['min-hits'])

/**
 * Section prefixes retried when the bare host yields nothing.
 *
 * Ordered by how often they pay off on a miss, so the common case costs one
 * extra query rather than two.
 */
const SECTIONS = ['blog', 'news']

/** Rows to pull per probe. Enough to clear MIN_HITS through a field of noise. */
const PROBE_LIMIT = 60

type Probe = { hits: number; sample: string | null; failed: boolean }

async function cdxProbe(prefix: string): Promise<Probe> {
  const url = new URL('https://web.archive.org/cdx/search/cdx')
  url.searchParams.set('url', `${prefix}/20`)
  url.searchParams.set('matchType', 'prefix')
  url.searchParams.set('output', 'json')
  url.searchParams.set('collapse', 'urlkey')
  url.searchParams.set('fl', 'original,timestamp')
  url.searchParams.set('limit', String(PROBE_LIMIT))
  url.searchParams.append('filter', 'statuscode:200')
  url.searchParams.append('filter', 'mimetype:text/html')

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(90_000),
      })
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 2) return { hits: 0, sample: null, failed: true }
        await new Promise((r) => setTimeout(r, 4000 * 2 ** attempt))
        continue
      }
      if (!response.ok) return { hits: 0, sample: null, failed: true }
      const text = await response.text()
      if (!text.trim()) return { hits: 0, sample: null, failed: false }

      const rows = (JSON.parse(text) as string[][]).slice(1)
      let hits = 0
      let sample: string | null = null
      const seen = new Set<string>()
      for (const [original, timestamp] of rows) {
        const label = parsePermalinkDate(original)
        if (!label) continue
        // The same free check the harvester makes: a page cannot be archived
        // before it was published, so a "date" later than the capture is a
        // product code or a version, not a label.
        if (!labelPrecedesCapture(label.published, timestamp)) continue
        // Distinct days only. A site that reprints one date across a hundred
        // paginated URLs is not a hundred labels.
        if (seen.has(label.published)) continue
        seen.add(label.published)
        hits++
        sample ??= `${label.evidence} @${timestamp.slice(0, 8)}`
      }
      return { hits, sample, failed: false }
    } catch {
      if (attempt === 2) return { hits: 0, sample: null, failed: true }
      await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt))
    }
  }
  return { hits: 0, sample: null, failed: true }
}

type Decision = {
  domain: string
  rank: number
  seed: string | null
  hits: number
  sample: string | null
  failed: boolean
}

/**
 * Serialise the rewrites.
 *
 * Every worker calls this on every acceptance, and two overlapping full-file
 * writes can interleave into a corrupt seed list. Chaining is enough — the file
 * is a few KB and the writes are rare relative to the queries around them.
 */
let pendingWrite: Promise<void> = Promise.resolve()

function writeSeeds(accepted: Decision[]): Promise<void> {
  const snapshot = [...accepted].sort((a, b) => a.rank - b.rank)
  pendingWrite = pendingWrite.then(async () => {
    const header = [
      '# Seed prefixes probed out of a published domain ranking.',
      '#',
      '# GENERATED by scripts/corpus/probe-seeds.ts — do not hand-edit. Adding a',
      '# domain here by hand reintroduces exactly the bias the frame removes.',
      '#',
      `# Frame:      ${values.list}, top ${TOP}`,
      `# Predicate:  >= ${MIN_HITS} distinct day-precision permalinks in Wayback,`,
      '#             read by the same parsePermalinkDate the harvester uses.',
      `# Probed:     bare host, then ${SECTIONS.map((s) => `/${s}`).join(' and ')} on a miss.`,
      '#',
      '# The trailing comment on each line is the rank in the frame, the number of',
      '# distinct dates the probe saw, and one matching path with its capture.',
      '',
    ].join('\n')
    const body = snapshot
      .map((d) => `${d.seed}  # rank ${d.rank}, ${d.hits} hits, ${d.sample ?? ''}`)
      .join('\n')
    await writeFile(values.out!, `${header}${body}\n`)
  })
  return pendingWrite
}

async function main(): Promise<void> {
  if (!values.list) throw new Error('--list <tranco.csv> is required')

  const rows = (await readFile(values.list, 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rank, domain] = line.split(',')
      return { rank: Number(rank), domain }
    })
    .filter((r) => r.domain && Number.isFinite(r.rank))
    .slice(0, TOP)

  let done = new Set<string>()
  try {
    done = new Set(
      (await readFile(values.state!, 'utf8')).split('\n').map((l) => l.trim()).filter(Boolean),
    )
  } catch {
    /* first run */
  }

  const todo = rows.filter((r) => !done.has(r.domain))
  console.log(`${rows.length} domains in frame, ${todo.length} still to probe`)

  const accepted: Decision[] = []
  let index = 0
  let failures = 0
  let processed = 0

  const worker = async (): Promise<void> => {
    while (index < todo.length) {
      const { domain, rank } = todo[index++]

      let decision: Decision = { domain, rank, seed: null, hits: 0, sample: null, failed: false }

      const bare = await cdxProbe(domain)
      if (bare.hits >= MIN_HITS) {
        decision = { domain, rank, seed: domain, hits: bare.hits, sample: bare.sample, failed: false }
      } else if (bare.failed) {
        decision.failed = true
      } else {
        for (const section of SECTIONS) {
          const probe = await cdxProbe(`${domain}/${section}`)
          if (probe.failed) decision.failed = true
          if (probe.hits >= MIN_HITS) {
            decision = {
              domain,
              rank,
              seed: `${domain}/${section}`,
              hits: probe.hits,
              sample: probe.sample,
              failed: false,
            }
            break
          }
        }
      }

      processed++
      if (decision.failed) failures++
      if (decision.seed) {
        accepted.push(decision)
        console.log(
          `  + ${String(rank).padStart(5)}  ${decision.seed.padEnd(38)} ${String(decision.hits).padStart(3)} hits   ${decision.sample ?? ''}`,
        )
        // Rewritten on every acceptance rather than once at the end. Probing a
        // five-figure frame runs for hours against a service with no SLA, and a
        // run that only produces its output on a clean exit is a run whose
        // partial result is worth nothing — which is the same reason `harvest.ts`
        // writes its manifest incrementally.
        await writeSeeds(accepted)
      }
      if (processed % 100 === 0) {
        console.log(`  … ${processed}/${todo.length} probed, ${accepted.length} accepted`)
      }

      // A domain whose probes all errored is NOT marked done: leaving it out of
      // the state file is what makes "re-run to retry" mean something. Marking
      // it would bake a hole in the frame permanently, and a frame with unknown
      // holes is the thing this script exists to replace.
      if (!decision.failed) await appendFile(values.state!, `${domain}\n`)
      if (!decision.seed && !decision.failed) {
        await appendFile(values.rejects!, `${rank},${domain}\n`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  await writeSeeds(accepted)

  console.log(`\n${accepted.length} seeds → ${values.out}`)
  console.log(`  ${processed} domains probed, ${accepted.length} accepted, ${processed - accepted.length - failures} rejected`)
  if (failures) {
    console.log(`  ${failures} domains had a FAILED probe and were not marked done — re-run to retry.`)
  }
  const sectioned = accepted.filter((d) => d.seed !== d.domain).length
  console.log(`  ${sectioned} of the accepted seeds needed a section prefix.`)
}

await main()
