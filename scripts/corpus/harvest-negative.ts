/**
 * Harvest negative examples: pages whose correct answer is "there is no
 * publication date here".
 *
 *   node scripts/corpus/harvest-negative.ts               # hosts already in the manifest
 *   node scripts/corpus/harvest-negative.ts --per-host 4
 *
 * This is the tier the corpus was missing, and its absence was not a gap in
 * coverage — it was a gap in what the metric could express. On a corpus where
 * every page has a determinable date, a tool that declines to answer can only
 * lose points and can never gain any, so "precision" measures how often a tool
 * is right *given that it answered* a question guaranteed to have an answer.
 * Under that metric the correct behaviour on an undated page — saying so — is
 * indistinguishable from failure, and a tool that invents a date for every page
 * it cannot read scores strictly better than one that admits it.
 *
 * htmldate's published corpus has the same hole, so every precision figure in
 * this field inherits it. Adding negatives is the only way to measure the thing
 * this library is actually built around.
 *
 * ## Why these page types, and why they are not a judgement call
 *
 * A negative label is a claim about a whole document, which makes it far harder
 * to justify than a permalink label: `/2019/08/05/slug` is checkable by reading
 * the path, whereas "nothing in these 300 KB is a publication date" is not
 * checkable by reading anything short. So the classes here are ones where the
 * claim follows from **what kind of page it is** rather than from an inspection
 * of its contents:
 *
 * - `homepage` — a site's front page is a view over other documents. It is
 *   continuously rewritten and has no publication instant of its own. Any date
 *   an extractor finds there belongs to a story on it, which is precisely the
 *   `isBorrowedContent` case the library rejects on purpose, and precisely the
 *   error htmldate's own corpus contains (`stuttgart.de`, gold 2017-10-09, read
 *   off a "Heute" events link generated at crawl time).
 *
 * - `policy` — about, contact, privacy, terms, imprint. Evergreen pages that
 *   sites maintain rather than publish. Some do carry a "last updated" line,
 *   which is a *modification* date; this corpus scores `published`, and these
 *   pages have none.
 *
 * Both are still only *proposals*. See the review gate below.
 *
 * ## The review gate, and why this script cannot skip it
 *
 * CONTRIBUTING.md: "do not let a model write or adjudicate a label. The corpus
 * answer key is the one artefact in this repository that has to be checked by a
 * person, because a model that both writes the extractor and grades it is a
 * closed loop."
 *
 * That rule binds hardest here. A wrongly-negative label — a page that does have
 * a publication date, marked as having none — hands a free false positive to
 * every tool measured, and it would do so in the direction that flatters this
 * project, because declining to answer is what this library does more than its
 * competitors. So every entry this script writes is `review: 'pending'`, no
 * scorer counts a pending negative unless explicitly asked to, and promotion is
 * a human edit. The script proposes; it does not label.
 *
 * `node scripts/corpus/review-negative.ts` renders each candidate with the
 * date-shaped strings found in it, which is the working surface for that pass.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  archiveUrl,
  entryId,
  readManifest,
  writeFileAtomic,
  writeManifest,
  type CorpusEntry,
} from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const OUT_DIR = join(ROOT, 'corpus')
const MANIFEST = join(OUT_DIR, 'manifest.jsonl')
const STATE = join(OUT_DIR, 'harvested-negative-hosts.txt')
const USER_AGENT =
  'pagedate-corpus/0.1 (benchmark corpus construction; +https://github.com/mathieutreves/website-date)'

const { values } = parseArgs({
  options: {
    /** Default: every host already represented in the manifest. */
    hosts: { type: 'string' },
    'per-host': { type: 'string', default: '3' },
    concurrency: { type: 'string', default: '3' },
  },
})

const PER_HOST = Number(values['per-host'])
const CONCURRENCY = Number(values.concurrency)

/**
 * Paths probed for the `policy` class.
 *
 * Deliberately short and in several languages, because the corpus is not
 * English-only and an English-only probe list would make the negative tier the
 * one stratum that is. Each is tried as an exact URL match, so a site that does
 * not have one simply yields nothing.
 */
const POLICY_PATHS = [
  '/about',
  '/about-us',
  '/about/',
  '/contact',
  '/privacy',
  '/privacy-policy',
  '/terms',
  '/impressum', // de
  '/datenschutz', // de
  '/mentions-legales', // fr
  '/chi-siamo', // it
  '/sobre', // pt/es
  '/quienes-somos', // es
]

/**
 * Capture years to spread the negatives across.
 *
 * A homepage captured only in 2025 tests 2025 markup. The positive tier samples
 * eight publication eras deliberately, and a negative tier clustered in one year
 * would make "does this tool invent dates" a question answered on modern markup
 * alone — when the pages where dates are hardest to read, and therefore easiest
 * to invent, are the old ones.
 */
const CAPTURE_YEARS = [2009, 2015, 2021, 2025]

type CdxRow = string[]

async function cdx(params: Record<string, string>, filters: string[] = []): Promise<CdxRow[] | null> {
  const url = new URL('https://web.archive.org/cdx/search/cdx')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  url.searchParams.set('output', 'json')
  url.searchParams.set('fl', 'original,timestamp,statuscode,mimetype,digest,length')
  for (const filter of filters) url.searchParams.append('filter', filter)

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(90_000),
      })
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 2) return null
        await new Promise((r) => setTimeout(r, 4000 * 2 ** attempt))
        continue
      }
      if (!response.ok) return null
      const text = await response.text()
      if (!text.trim()) return []
      return (JSON.parse(text) as CdxRow[]).slice(1)
    } catch {
      if (attempt === 2) return null
      await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt))
    }
  }
  return null
}

function toEntry(
  row: CdxRow,
  host: string,
  pageType: string,
  frame?: 'hand' | 'tranco',
): CorpusEntry | null {
  const [original, timestamp, statuscode, mimetype, digest, length] = row
  if (!original || !timestamp) return null

  return {
    id: entryId(`${original}#${timestamp}`),
    url: original,
    snapshot: timestamp,
    archiveUrl: archiveUrl(timestamp, original),
    // A page with no publication date has no gap between publication and
    // capture. Zero rather than null so the field keeps one type, and every
    // scorer skips the lag filter for negatives anyway.
    captureLagDays: 0,
    label: {
      published: null,
      // `precision` is meaningless without a date. 'day' is the schema's
      // narrowest value and is never read for a negative.
      precision: 'day',
      source: 'none',
      // Silver until a person says otherwise. The tier and the review flag say
      // the same thing from two directions, and both are checked before scoring.
      tier: 'silver',
      evidence: `${pageType}: proposed as having no publication date of its own`,
      review: 'pending',
    },
    // Nothing to hold out: the label was not derived from any channel an
    // extractor reads. That is the one nice property negatives have.
    holdOut: [],
    strata: {
      host,
      tld: host.slice(host.lastIndexOf('.') + 1),
      // No publication year, because there is no publication.
      era: null,
      pageType,
      // Inherited from whatever put this host in the corpus. A negative is not
      // sampled from a seed frame of its own — it is a second page type taken
      // from a host already present — so it carries that host's provenance
      // rather than none at all.
      frame,
    },
    http: {
      status: Number(statuscode),
      mime: mimetype,
      digest,
      length: Number(length) || 0,
    },
  }
}

/** One capture per target year, so the class spans eras rather than clustering. */
function spreadByYear(rows: CdxRow[], want: number): CdxRow[] {
  const picked: CdxRow[] = []
  const used = new Set<string>()
  for (const year of CAPTURE_YEARS) {
    if (picked.length >= want) break
    const match = rows.find((r) => r[1]?.startsWith(String(year)) && !used.has(r[1]))
    if (match) {
      used.add(match[1])
      picked.push(match)
    }
  }
  // If the site is too young or too thinly captured to fill the year quota, take
  // whatever else exists rather than returning fewer pages than asked for.
  for (const row of rows) {
    if (picked.length >= want) break
    if (!used.has(row[1])) {
      used.add(row[1])
      picked.push(row)
    }
  }
  return picked.slice(0, want)
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })

  let existing: CorpusEntry[] = []
  try {
    existing = readManifest(await readFile(MANIFEST, 'utf8'))
  } catch {
    /* first run */
  }

  const hosts = values.hosts
    ? (await readFile(values.hosts, 'utf8'))
        .split('\n')
        .map((l) => l.replace(/#.*$/, '').trim())
        .filter(Boolean)
    : [...new Set(existing.map((e) => e.strata.host))].sort()

  let done = new Set<string>()
  try {
    done = new Set(
      (await readFile(STATE, 'utf8')).split('\n').map((l) => l.trim()).filter(Boolean),
    )
  } catch {
    /* first run */
  }

  const seen = new Set(existing.map((e) => e.id))
  const frameOf = new Map<string, 'hand' | 'tranco'>()
  for (const e of existing) {
    if (e.strata.frame && !frameOf.has(e.strata.host)) frameOf.set(e.strata.host, e.strata.frame)
  }
  const todo = hosts.filter((h) => !done.has(h))
  console.log(`${hosts.length} hosts, ${todo.length} still to probe for negatives`)

  const collected: CorpusEntry[] = []
  let index = 0

  const worker = async (): Promise<void> => {
    while (index < todo.length) {
      const host = todo[index++]
      const kept: CorpusEntry[] = []

      // Homepages. `matchType=exact` on the bare root, so a query string or a
      // deep path cannot sneak in as a "homepage".
      const home = await cdx(
        { url: `${host}/`, matchType: 'exact', collapse: 'timestamp:6', limit: '400' },
        ['statuscode:200', 'mimetype:text/html'],
      )
      if (home && home.length) {
        for (const row of spreadByYear(home, PER_HOST)) {
          const entry = toEntry(row, host, 'homepage', frameOf.get(host))
          if (entry && !seen.has(entry.id)) {
            seen.add(entry.id)
            kept.push(entry)
          }
        }
      }

      // Policy pages: one capture each, first match wins, capped so a site with
      // every path in the list does not dominate the tier.
      let policies = 0
      for (const path of POLICY_PATHS) {
        if (policies >= PER_HOST) break
        const rows = await cdx(
          { url: `${host}${path}`, matchType: 'exact', collapse: 'timestamp:8', limit: '40' },
          ['statuscode:200', 'mimetype:text/html'],
        )
        if (!rows || rows.length === 0) continue
        const entry = toEntry(spreadByYear(rows, 1)[0], host, 'policy', frameOf.get(host))
        if (entry && !seen.has(entry.id)) {
          seen.add(entry.id)
          kept.push(entry)
          policies++
        }
      }

      collected.push(...kept)
      console.log(
        `  ${host.padEnd(30)} ${String(kept.length).padStart(3)} candidates` +
          `  (${kept.filter((e) => e.strata.pageType === 'homepage').length} homepage,` +
          ` ${kept.filter((e) => e.strata.pageType === 'policy').length} policy)`,
      )

      await writeFileAtomic(MANIFEST, writeManifest([...existing, ...collected]))
      await appendFile(STATE, `${host}\n`)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  console.log(`\n${collected.length} negative candidates added → corpus/manifest.jsonl`)
  console.log(`  all are review: 'pending' and score nowhere until a person confirms them.`)
  console.log(`\nnext: node scripts/corpus/fetch.ts`)
  console.log(`then: node scripts/corpus/review-negative.ts`)
}

await main()
