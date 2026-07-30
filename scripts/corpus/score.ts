/**
 * Score pagedate against the harvested corpus.
 *
 *   node scripts/corpus/score.ts                      # dev split, standard mode
 *   node scripts/corpus/score.ts --mode extensive
 *   node scripts/corpus/score.ts --max-lag 9999       # include drifted captures
 *   node scripts/corpus/score.ts --split diag         # the pool you may investigate
 *   node scripts/corpus/score.ts --split test         # ONCE, when you are done tuning
 *
 * Three rules make the number mean something, and all three are enforced here
 * rather than left to the caller:
 *
 * **`holdOut` is honoured, per entry.** Every entry names the extractor sources
 * that share provenance with its label, and each entry is treated according to
 * its own list rather than to a blanket rule. A page labelled from its URL has
 * the date blanked out of that URL before extraction; a page labelled from a
 * feed does not, because for that entry the URL is independent evidence and
 * blanking it would throw away the one tier that can measure what URL detection
 * is worth. Applying one treatment to every entry is how the feed tier ended up
 * measuring nothing.
 *
 * **The split is by host, and there are three of them.** Tuning against a corpus
 * and then reporting on it recreates the problem this corpus was built to
 * expose, so `test` is held out. But a purely two-way split also makes its own
 * failures undiagnosable, so `diag` exists to be read. See `splitOf`.
 *
 * **"No date" is a scored answer.** Entries labelled `none` have no publication
 * date, and the correct response to them is to return nothing. They are counted
 * in their own two cells — a correct abstention and a false positive — and a
 * false positive costs precision exactly as a wrong date does. Without them a
 * corpus can only reward answering, which is why every published figure in this
 * field flatters tools that never decline.
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  isNegative,
  isScorableNegative,
  readManifest,
  splitOf,
  type CorpusEntry,
} from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MANIFEST = join(ROOT, 'corpus', 'manifest.jsonl')
const CACHE = join(ROOT, 'corpus', 'cache')

/**
 * "Now", for a page, is the moment it was archived.
 *
 * A constant is the wrong shape for this, and not merely inelegant: the
 * plausibility check rejects future dates, so any page published after the
 * constant has its correct, declared date discarded and scored as a miss. On
 * this corpus that is the twelve pages captured during the 2026 harvest — 6 of
 * the dev split, 6 of the held-out one, and the whole of one host. A constant
 * cannot be right for a corpus that keeps growing, and it is not what a caller
 * experiences either, since their clock is always later than the page they are
 * reading.
 *
 * The capture instant is the honest simulation: it is when this exact HTML was
 * in front of a reader. It also makes the guard mean something on old pages,
 * where a frozen 2026 would accept any date up to twenty years past the
 * capture.
 */
function capturedAt(entry: CorpusEntry): Date {
  const s = entry.snapshot
  return new Date(
    `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`,
  )
}

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
     * are correct. Measured on the dev split, 14 of 20 "wrong" answers are
     * exactly this. Strict scoring charges the extractor for trusting the site's
     * own machine-readable metadata over a path segment, which is backwards.
     *
     * Reported alongside strict rather than replacing it — silently allowing a
     * day would hide genuine off-by-one bugs.
     */
    tolerance: { type: 'string', default: '0' },
    /**
     * Count negative entries a person has not yet confirmed.
     *
     * Off by default, and the asymmetry is the reason: a wrongly-negative label
     * gives every tool a false positive on a page that does have a date, which
     * raises our relative standing because abstaining is what this library does
     * more of. Useful for seeing what the tier will be worth once reviewed;
     * never for a published figure.
     */
    'include-unreviewed': { type: 'boolean', default: false },
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
 * and `extractDeclaredUrlSlug` reads exactly there. Measured: without this the
 * corpus reports +10 pages and zero misses, all of it the holdout leaking rather
 * than a signal being found.
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
 * Six cells, not four.
 *
 * `tn` and `fp` are the negative entries — pages with no publication date. They
 * are kept apart from `exact`/`missed` because merging them destroys the
 * distinction the corpus was extended to measure: a tool that returns nothing on
 * a dated page and a tool that returns nothing on an undated one have done
 * opposite things, and one column cannot say so.
 */
type Tally = {
  exact: number
  partial: number
  wrong: number
  missed: number
  /** Negative entry, nothing returned. The answer this field usually cannot win. */
  tn: number
  /** Negative entry, a date returned. An invented date. */
  fp: number
}
const empty = (): Tally => ({ exact: 0, partial: 0, wrong: 0, missed: 0, tn: 0, fp: 0 })

/**
 * Compare at the label's own precision.
 *
 * A month-precision label ("2016-12") is satisfied by any December 2016 answer;
 * scoring it against a full date would punish a correct result. In the other
 * direction pagedate may answer more coarsely than the label — right, but less
 * useful — which is `partial`.
 *
 * A null label is a negative example, and inverts the reading of `found`:
 * returning nothing is then the correct answer and returning a date is a false
 * positive, whatever date it is.
 */
function judge(
  t: Tally,
  label: string | null,
  found: string | null,
  toleranceDays = 0,
): keyof Tally {
  if (label === null) return found === null ? (t.tn++, 'tn') : (t.fp++, 'fp')
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

/**
 * Precision counts a false positive against the tool, accuracy counts a correct
 * abstention for it.
 *
 * This is the whole reason the negative tier exists. On a corpus of dated pages
 * only, declining to answer can lose points and can never win any, so the metric
 * silently rewards guessing and every published precision figure in this field
 * is computed over pages that were guaranteed to have an answer. With negatives
 * in, `fp` joins the denominator of precision — an invented date is exactly as
 * wrong as a misread one — and `tn` joins the numerator of accuracy.
 */
function line(name: string, t: Tally): string {
  const n = t.exact + t.partial + t.wrong + t.missed + t.tn + t.fp
  const answered = t.exact + t.partial + t.wrong + t.fp
  const correct = t.exact + t.tn
  return (
    `  ${name.padEnd(26)} ${String(n).padStart(5)} ` +
    `${String(t.exact).padStart(6)} ${String(t.partial).padStart(5)} ` +
    `${String(t.wrong).padStart(6)} ${String(t.missed).padStart(5)} ` +
    `${String(t.tn).padStart(5)} ${String(t.fp).padStart(4)} | ` +
    `${rate(t.exact, answered).padStart(8)} ${rate(correct, n).padStart(9)}`
  )
}

const HEADER =
  '  stratum                        n  exact  part  wrong  miss    TN   FP | precision  accuracy'

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

  // A negative entry has `published: null` by definition, so the old truthiness
  // test on it dropped every one of them before they reached the scorer. The
  // review gate is what replaces that test: proposed negatives are visible to
  // `review-negative.ts` and to nothing else.
  const negativeOk = values['include-unreviewed'] ? isNegative : isScorableNegative
  let entries = all.filter((e) => e.fetch && (e.label.published !== null || negativeOk(e)))
  const pendingNegatives = all.filter(
    (e) => e.fetch && isNegative(e) && e.label.review !== 'confirmed',
  ).length
  const fetched = entries.length
  if (values.split !== 'all') {
    entries = entries.filter((e) => splitOf(e.strata.host) === values.split)
  }
  const beforeLag = entries.length
  // Capture lag is the gap between publication and capture, and a page with no
  // publication date has no such gap. Filtering negatives on it would drop them
  // for failing to have a property the label asserts they do not have.
  entries = entries.filter((e) => isNegative(e) || e.captureLagDays <= MAX_LAG)
  const beforeAnswerable = entries.length
  if (!values['include-unanswerable']) {
    // Likewise `labelInPage`: there is no label date to look for on a negative.
    entries = entries.filter((e) => isNegative(e) || e.strata.labelInPage !== false)
  }
  const negatives = entries.filter(isNegative).length
  if (values.limit) entries = entries.slice(0, Number(values.limit))

  console.log(
    `\n${all.length} manifest entries, ${fetched} fetched, ` +
      `${beforeLag} in split "${values.split}", ${beforeAnswerable} within lag ${MAX_LAG}d, ` +
      `${entries.length} scored (${entries.length - negatives} dated, ${negatives} negative)`,
  )
  if (beforeAnswerable > entries.length) {
    console.log(
      `  excluded ${beforeAnswerable - entries.length} entries whose label appears nowhere in the page` +
        ` (run enrich.ts; --include-unanswerable to keep them)`,
    )
  }
  // Stated on every run, because "accuracy" means a different thing with and
  // without negatives and a reader comparing two tables has no other way to tell
  // which one they are holding.
  if (negatives === 0) {
    console.log(
      `  NO NEGATIVE ENTRIES in this split — precision here cannot see an invented\n` +
        `  date, and abstaining can only lose points. See docs/CORPUS-BUILD.md.`,
    )
  }
  if (pendingNegatives > 0) {
    console.log(
      `  ${pendingNegatives} proposed negatives are awaiting human review and are NOT scored` +
        `\n  (node scripts/corpus/review-negative.ts; --include-unreviewed to preview).`,
    )
  }
  if (values['include-unreviewed']) {
    console.log(
      `\n  *** UNREVIEWED NEGATIVES INCLUDED — labels no person has checked. Preview only. ***`,
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
  let backstopDropped = 0

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

    // The rule the whole corpus design rests on, applied per entry.
    //
    // Neutralise rather than filter. Removing url-slug candidates *after*
    // extraction is not equivalent to not having them: extractFromDocument gates
    // the bare-text fallback on whether anything labelled was found, and a
    // url-slug hit counts as labelled — so a post-hoc filter silently suppresses
    // an extractor that would otherwise have run. Measured: it cost 9 of 201
    // pages. Blanking the date out of the URL reproduces "no URL signal"
    // faithfully, and is what bench_corpus.mjs does for every tool.
    //
    // Which entries get it is `holdOut`, not a blanket rule. The 12 feed-labelled
    // entries hold out `feed`, not `url-slug`: their label came from a <pubDate>,
    // so for them the URL is independent evidence and reading it is fair. Blanking
    // it there was the reason the feed tier — which exists precisely so that URL
    // detection can be scored at all — measured nothing.
    const holdOut = new Set(values['no-holdout'] ? [] : entry.holdOut)
    const urlHeldOut = holdOut.has('url-slug')
    const scoringUrl = urlHeldOut ? neutralise(entry.url) : entry.url
    if (urlHeldOut) neutraliseDeclaredUrls(document)

    const candidates = extractFromDocument(document, scoringUrl, { mode: values.mode })

    // Backstop for the sources `holdOut` names that neutralising cannot reach —
    // today that is `feed`, which this scorer never produces because it passes no
    // Env and so makes no network request. It should therefore never fire. It is
    // here because "never fires" is a property of the current call, not of the
    // design: give this scorer an Env and the feed tier silently becomes circular
    // with nothing to catch it. Anything it drops is counted and reported, since
    // a filter that quietly does work the neutralisation was supposed to do means
    // the two disagree and the numbers are not what they claim.
    const kept = holdOut.size === 0 ? candidates : candidates.filter((c) => !holdOut.has(c.source))
    backstopDropped += candidates.length - kept.length

    const published = resolveCandidates(kept, { now: capturedAt(entry) }).published
    const found = published?.value.slice(0, 10) ?? null
    const label = entry.label.published

    const outcome = judge(overall, label, found, TOLERANCE)
    judge(bump(byHost, entry.strata.host), label, found, TOLERANCE)
    judge(bump(byEra, String(entry.strata.era)), label, found, TOLERANCE)
    judge(bump(byLang, entry.strata.lang ?? 'unknown'), label, found, TOLERANCE)
    judge(bump(byLag, lagBucket(entry.captureLagDays)), label, found, TOLERANCE)

    if (outcome === 'exact' && published) {
      winners.set(published.source, (winners.get(published.source) ?? 0) + 1)
    }
    // A false positive is a failure on the same footing as a wrong date — it is a
    // date the page does not have — so the worst-hosts list has to count it, or
    // the hosts where dates get invented never appear in it.
    if (outcome === 'missed' || outcome === 'wrong' || outcome === 'fp') {
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

  if (backstopDropped > 0) {
    console.log(
      `\n  *** holdOut BACKSTOP dropped ${backstopDropped} candidates. Neutralisation was\n` +
        `      supposed to prevent every one of them. The two disagree — investigate\n` +
        `      before quoting this table. ***`,
    )
  }

  if (overall.tn + overall.fp > 0) {
    const negN = overall.tn + overall.fp
    console.log(`\n=== NEGATIVE ENTRIES (pages with no publication date) ===\n`)
    console.log(`  n                       ${String(negN).padStart(5)}`)
    console.log(`  correctly declined      ${String(overall.tn).padStart(5)}   ${rate(overall.tn, negN)}`)
    console.log(`  invented a date         ${String(overall.fp).padStart(5)}   ${rate(overall.fp, negN)}`)
  }

  console.log(`\n=== WORST HOSTS (wrong + missed + invented) ===\n`)
  for (const [host, n] of [...missedHosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    const t = byHost.get(host)!
    const total = t.exact + t.partial + t.wrong + t.missed
    console.log(`  ${host.padEnd(30)} ${String(n).padStart(4)} of ${String(total).padStart(4)}`)
  }
}

await main()
