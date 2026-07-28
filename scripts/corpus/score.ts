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
// The parser `pagedate/node` ships, so this scores what callers actually run.
const { parseHtml } = await import(join(ROOT, 'packages', 'pagedate', 'dist', 'node', 'index.js'))
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
    /**
     * Keep entries whose label appears nowhere in the page (`labelInPage` false).
     * They are excluded by default: with `url-slug` held out, no extractor could
     * recover the label, so scoring them punishes correctly finding nothing.
     */
    'include-unanswerable': { type: 'boolean', default: false },
    /**
     * Score WITHOUT applying holdOut — i.e. let `url-slug` answer a label that
     * came from the URL. This is circular and always flattering; it is here only
     * to quantify what URL detection is worth in production, where reading the
     * URL is perfectly legitimate. Never quote it as accuracy.
     */
    'no-holdout': { type: 'boolean', default: false },
    /**
     * Days of slack when comparing to the label.
     *
     * Permalink labels carry inherent ±1 day noise: a post published at 23:30
     * local gets a local-date URL and a UTC `article:published_time`, and both
     * are correct. Measured on the dev split, 6 of 7 "wrong" answers were
     * exactly this. Strict scoring charges the extractor for trusting the site's
     * own machine-readable metadata over a path segment, which is backwards.
     *
     * Reported alongside strict rather than replacing it — silently allowing a
     * day would hide genuine off-by-one bugs.
     */
    tolerance: { type: 'string', default: '0' },
  },
})

const MAX_LAG = Number(values['max-lag'])
const TOLERANCE = Number(values.tolerance)

/** Blank date-shaped path segments so no extractor can read the label off the URL. */
function neutralise(rawUrl: string): string {
  return rawUrl
    .replace(/\/(19|20)\d{2}\/\d{1,2}\/\d{1,2}(?=\/|$|[?#])/g, '/yr/mo/dy')
    .replace(/\/(19|20)\d{2}-\d{2}-\d{2}/g, '/yr-mo-dy')
}

/**
 * The same blanking, applied to the URLs the page declares *about itself*.
 *
 * Neutralising only the fetched URL does not hold the label out: `<link
 * rel="canonical">` and `og:url` carry the permalink verbatim, one hop away,
 * and `extractDeclaredUrlSlug` reads exactly there. Measured when that
 * extractor was added — without this the corpus reported +10 pages and zero
 * misses, all of it the holdout leaking rather than a signal being found.
 *
 * Mutating the parsed document rather than filtering candidates afterwards, for
 * the same reason `neutralise` exists at all: `extractFromDocument` gates the
 * bare-text fallback on whether anything labelled was found, so a post-hoc
 * filter suppresses extractors that would otherwise have run.
 */
function neutraliseDeclaredUrls(doc: Document): void {
  for (const el of doc.querySelectorAll('link[rel="canonical"]')) {
    const href = el.getAttribute('href')
    if (href) el.setAttribute('href', neutralise(href))
  }
  for (const el of doc.querySelectorAll('meta[property="og:url"], meta[name="og:url"]')) {
    const content = el.getAttribute('content')
    if (content) el.setAttribute('content', neutralise(content))
  }
}

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
function judge(t: Tally, label: string, found: string | null, toleranceDays = 0): keyof Tally {
  if (found === null) return (t.missed++, 'missed')
  const width = Math.min(label.length, found.length)
  if (label.slice(0, width) !== found.slice(0, width)) {
    // Within tolerance counts as exact, but only for full dates: sliding a
    // month-precision label by a day is meaningless.
    if (toleranceDays > 0 && label.length === 10 && found.length >= 10) {
      const gap = Math.abs(Date.parse(found.slice(0, 10)) - Date.parse(label)) / 86_400_000
      if (Number.isFinite(gap) && gap <= toleranceDays) return (t.exact++, 'exact')
    }
    return (t.wrong++, 'wrong')
  }
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
  const beforeAnswerable = entries.length
  if (!values['include-unanswerable']) {
    entries = entries.filter((e) => e.strata.labelInPage !== false)
  }
  if (values.limit) entries = entries.slice(0, Number(values.limit))

  console.log(
    `\n${all.length} manifest entries, ${fetched} fetched, ` +
      `${beforeLag} in split "${values.split}", ${beforeAnswerable} within lag ${MAX_LAG}d, ` +
      `${entries.length} scored`,
  )
  if (beforeAnswerable > entries.length) {
    console.log(
      `  excluded ${beforeAnswerable - entries.length} entries whose label appears nowhere in the page` +
        ` (run enrich.ts; --include-unanswerable to keep them)`,
    )
  }
  if (values['no-holdout']) {
    console.log(`\n  *** holdOut DISABLED — url-slug may answer a URL-derived label. Circular. ***`)
  }
  if (values.split === 'test') {
    console.log(`\n  *** SCORING THE HELD-OUT SPLIT. Do this once, at the end. ***`)
  }

  const overall = empty()
  const byHost = new Map<string, Tally>()
  const byEra = new Map<string, Tally>()
  const byLang = new Map<string, Tally>()
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

    const document = parseHtml(html)
    // The rule the whole corpus design rests on.
    // Neutralise rather than filter. Removing url-slug candidates *after*
    // extraction is not equivalent to not having them: extractFromDocument gates
    // the bare-text fallback on whether anything labelled was found, and a
    // url-slug hit counts as labelled — so a post-hoc filter silently suppresses
    // an extractor that would otherwise have run. Measured: it cost 9 of 201
    // pages. Blanking the date out of the URL reproduces "no URL signal"
    // faithfully, and is what bench_corpus.mjs does for every tool.
    const scoringUrl = values['no-holdout'] ? entry.url : neutralise(entry.url)
    if (!values['no-holdout']) neutraliseDeclaredUrls(document)
    const candidates = extractFromDocument(document, scoringUrl, { mode: values.mode })
    const published = resolveCandidates(candidates, { now: NOW }).published
    const found = published?.value.slice(0, 10) ?? null

    const outcome = judge(overall, entry.label.published!, found, TOLERANCE)
    judge(bump(byHost, entry.strata.host), entry.label.published!, found, TOLERANCE)
    judge(bump(byEra, String(entry.strata.era)), entry.label.published!, found, TOLERANCE)
    judge(bump(byLang, entry.strata.lang ?? 'unknown'), entry.label.published!, found, TOLERANCE)
    judge(bump(byLag, lagBucket(entry.captureLagDays)), entry.label.published!, found, TOLERANCE)

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
  // The question the htmldate corpus cannot answer, it being almost entirely
  // German. Read the row counts before the percentages: a language with eight
  // pages in it is an anecdote, not a measurement.
  table('=== BY LANGUAGE (from <html lang>) ===', byLang)
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
