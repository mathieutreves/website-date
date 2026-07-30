/**
 * Every JS tool, same pages, on our own corpus.
 *
 *   node bench/bench_corpus.mjs
 *   node bench/bench_corpus.mjs --split all --max-lag 9999
 *
 * The htmldate corpus is 55 pages of mostly German news, selected as that
 * project's unit tests. This runs the same comparison on the permalink corpus
 * instead — more pages, more years, more languages, and nobody's test set.
 *
 * **The URL is neutralised for every tool.** These labels come from the URL
 * path, so any tool that reads the URL scores free points. pagedate has
 * `holdOut` for exactly this, but the competitors do not, and disabling one
 * side's URL reader while leaving the others' intact would be worse than
 * useless. Instead every tool receives the same URL with the date segments
 * replaced, so none of them can read the answer. That makes this stricter than
 * `score.ts` and not directly comparable to it — URL detection is a legitimate
 * production signal, it just cannot be measured against a URL-derived label.
 *
 * **The permalink is blanked in the HTML too, not just in the URL argument.**
 * Blanking only the argument does not achieve the paragraph above. Every page
 * here repeats its own dated permalink in `<link rel="canonical">`, `og:url`
 * and a dozen `<a href>`s, so a tool that scans the document for URLs is handed
 * the label whatever the argument says. Measured on the dev split, blanking it
 * in the HTML as well costs pagedate 194 → 184 and htmldate (fast) 192 → 163.
 * Both read in-page URLs; the point is that they read them to very different
 * extents, so leaving them in ranks the tools by how hard they look for a URL
 * rather than by how well they read a document.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
// The split and the negative-entry predicate come from the corpus schema rather
// than being reimplemented here. Two copies of "which hosts are held out" is one
// copy too many: they drift, and the symptom is two tables that disagree about
// which pages they cover while both claiming to be the held-out split.
import { isNegative, isScorableNegative, splitOf } from '../scripts/corpus/schema.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const MANIFEST = join(ROOT, 'corpus', 'manifest.jsonl')
const CACHE = join(ROOT, 'corpus', 'cache')
/**
 * "Now" is when the page was captured, per page.
 *
 * A frozen constant here is wrong in one direction only, which is what makes it
 * dangerous. Every competitor reads the system clock, which is later than any
 * capture in this corpus and so never rejects anything; pagedate handed a fixed
 * date has its plausibility check discard the correct declared date on every
 * page harvested after it. The table then measures a harness constant.
 *
 * The capture instant restores parity and is the honest simulation besides: it
 * is the moment this HTML was actually in front of a reader. It is also
 * *stricter* than what the competitors get, which is the right direction for a
 * benchmark whose author is one of the entrants.
 */
const capturedAt = (snapshot) =>
  new Date(
    `${snapshot.slice(0, 4)}-${snapshot.slice(4, 6)}-${snapshot.slice(6, 8)}T` +
      `${snapshot.slice(8, 10)}:${snapshot.slice(10, 12)}:${snapshot.slice(12, 14)}Z`,
  )

const { values } = parseArgs({
  options: {
    split: { type: 'string', default: 'dev' },
    'max-lag': { type: 'string', default: '30' },
    limit: { type: 'string' },
    /**
     * Pass the real URL to every tool instead of a neutralised one.
     *
     * Circular by construction — these labels were read out of the URL, so any
     * tool that reads URLs scores free points and the accuracy column is an
     * upper bound, not a measurement. It is still worth running: it shows which
     * tools use the URL signal at all, which is a real production difference
     * that neutralising hides from the comparison entirely.
     */
    'raw-url': { type: 'boolean', default: false },
    /** Preview the negative tier before it has been reviewed. Never for a figure. */
    'include-unreviewed': { type: 'boolean', default: false },
    /**
     * Also write the per-page rows as JSONL, in the same shape bench_python.py
     * emits.
     *
     * Without this the JS and Python halves of a comparison could only be put in
     * one table by hand, and `results/permalink-TEST-combined.txt` was exactly
     * that: the headline competitor table, assembled by copying rows, with no
     * command that regenerates it and nothing to catch a transcription slip. Two
     * files of the same shape make it `node scripts/tally.ts a.jsonl b.jsonl`.
     */
    jsonl: { type: 'string' },
  },
})

/** Replace date-shaped path segments so no tool can read the label off the URL. */
function neutralise(rawUrl) {
  const u = new URL(rawUrl)
  u.pathname = u.pathname
    .replace(/\/(19|20)\d{2}\/\d{1,2}\/\d{1,2}(?=\/|$)/g, '/yr/mo/dy')
    .replace(/\/(19|20)\d{2}-\d{2}-\d{2}/g, '/yr-mo-dy')
  return u.toString()
}

/**
 * The same treatment for URLs written inside the document.
 *
 * Applied to the raw HTML rather than to parsed attributes, because the
 * permalink appears in `<link rel="canonical">`, `og:url`, JSON-LD `url`,
 * `<a href>`, inline JavaScript and Facebook comment widgets — and every tool
 * scans a different subset of those.
 *
 * The leading slash is required, so a date written as text (`2012/11/02`) is
 * left alone and only path segments are hit. The rewrite is identical for every
 * tool, so whatever it costs, it costs all of them equally.
 */
function neutraliseHtml(html) {
  return html
    .replace(/\/(19|20)\d{2}\/\d{1,2}\/\d{1,2}(?=[/"'<\s])/g, '/yr/mo/dy')
    .replace(/\/(19|20)\d{2}-\d{2}-\d{2}/g, '/yr-mo-dy')
}

const norm = (value) => {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(String(value).trim())
  return iso ? iso[1] : null
}

async function buildTools() {
  const tools = {}

  const pagedate = await import(join(ROOT, 'packages', 'pagedate', 'dist', 'index.js'))
  // The parser `pagedate/node` ships, so the row measures what a caller runs —
  // and, since every competitor here also parses inside the timed region, the
  // ms/page column compares like with like.
  const { parseHtml } = await import(join(ROOT, 'packages', 'pagedate', 'dist', 'node', 'index.js'))

  for (const mode of ['fast', 'standard', 'extensive']) {
    tools[`pagedate (${mode})`] = (html, url, now) => {
      const document = parseHtml(html)
      const candidates = pagedate.extractFromDocument(document, url, { mode })
      return pagedate.resolveCandidates(candidates, { now }).published?.value ?? null
    }
  }

  try {
    const metascraper = (await import('metascraper')).default
    const metascraperDate = (await import('metascraper-date')).default
    const scrape = metascraper([metascraperDate()])
    const pick = new Set(['date'])
    tools['metascraper'] = async (html, url) =>
      (await scrape({ html, url, pickPropNames: pick, validateUrl: false })).date
  } catch (error) {
    console.error('skip metascraper:', error.message)
  }

  try {
    const { extractFromHtml } = await import('@extractus/article-extractor')
    tools['@extractus/article-extractor'] = async (html, url) =>
      (await extractFromHtml(html, url))?.published ?? null
  } catch (error) {
    console.error('skip @extractus:', error.message)
  }

  try {
    const mod = await import('unfluff')
    const unfluff = mod.default ?? mod
    tools['unfluff'] = (html) => unfluff(html)?.date ?? null
  } catch (error) {
    console.error('skip unfluff:', error.message)
  }

  return tools
}

/**
 * A null label is a negative example: the page has no publication date, so
 * returning nothing is correct and returning a date is a false positive.
 *
 * Every tool here is judged by this same function, which is the point. The
 * abstention question — is a confidently wrong date worse than no date — cannot
 * be settled on a corpus where every page has an answer, because there refusing
 * to answer can only ever cost points.
 */
function judge(t, label, found) {
  if (label === null) return void (found === null ? t.tn++ : t.fp++)
  if (found === null) return void t.missed++
  const width = Math.min(label.length, found.length)
  if (label.slice(0, width) !== found.slice(0, width)) return void t.wrong++
  if (found.length >= label.length) return void t.exact++
  return void t.partial++
}

async function main() {
  const all = readManifest(await readFile(MANIFEST, 'utf8'))
  // `e.label.published` truthy would drop every negative entry, which is the
  // whole tier that makes a false positive visible. Only negatives a person has
  // confirmed are counted — see isScorableNegative.
  const negativeOk = values['include-unreviewed'] ? isNegative : isScorableNegative
  let entries = all.filter((e) => e.fetch && (e.label.published !== null || negativeOk(e)))
  if (values.split !== 'all') entries = entries.filter((e) => splitOf(e.strata.host) === values.split)
  // Neither capture lag nor labelInPage is defined for a page with no
  // publication date — there is no publication instant to lag behind, and no
  // label date to look for in the markup.
  entries = entries.filter((e) => isNegative(e) || e.captureLagDays <= Number(values['max-lag']))
  // Same exclusion score.ts makes: if the label is nowhere in the page, no tool
  // can find it and the entry measures nothing.
  entries = entries.filter((e) => isNegative(e) || e.strata.labelInPage !== false)
  if (values.limit) entries = entries.slice(0, Number(values.limit))

  const pages = []
  for (const entry of entries) {
    try {
      const html = await readFile(join(CACHE, `${entry.id}.html`), 'utf8')
      const id = entry.id
      // Per entry, from `holdOut` — not a blanket rule. Blanking the permalink is
      // what stops a URL-derived label being read back out of the document, and
      // it is required for exactly the entries whose label came from the URL. A
      // feed-labelled entry holds out `feed` instead, so for it the URL is
      // independent evidence and every tool is entitled to read it; blanking it
      // there deletes the only tier on which URL detection can be scored.
      const blank = !values['raw-url'] && entry.holdOut.includes('url-slug')
      pages.push({
        id,
        html: blank ? neutraliseHtml(html) : html,
        url: blank ? neutralise(entry.url) : entry.url,
        gold: entry.label.published,
        now: capturedAt(entry.snapshot),
      })
    } catch {
      /* not fetched */
    }
  }
  const negatives = pages.filter((p) => p.gold === null).length

  const tools = await buildTools()
  console.log(
    `\n${pages.length} pages (${pages.length - negatives} dated, ${negatives} with no date), ` +
      `split=${values.split}, ` +
      (values['raw-url']
        ? 'REAL URLs — circular, upper bound only\n'
        : 'URL neutralised where the label came from it\n'),
  )
  if (negatives === 0) {
    console.log(
      '  No negative entries in this split: a tool cannot be charged for inventing\n' +
        '  a date here, and declining can only lose points.\n',
    )
  }

  /**
   * Pages run untimed before a tool's measured pass, so the timing is not
   * dominated by JIT compilation.
   *
   * This is not a refinement. Without it the first tool measured pays to compile
   * every shared code path — the parser, the regex engine's caches, the resolver
   * — and later tools inherit all of it warm. The symptom is an impossible
   * table: whichever of `pagedate (standard)` and `pagedate (extensive)` runs
   * second comes out faster, when extensive is standard plus an extra extractor
   * and can never do less work.
   */
  const WARMUP_PAGES = 25

  const results = []
  const rows = []
  for (const [name, run] of Object.entries(tools)) {
    for (const page of pages.slice(0, WARMUP_PAGES)) {
      try {
        await run(page.html, page.url, page.now)
      } catch {
        /* a tool that throws here will throw in the measured pass too */
      }
    }

    const t = { exact: 0, partial: 0, wrong: 0, missed: 0, tn: 0, fp: 0 }
    const started = performance.now()
    for (const page of pages) {
      let found = null
      const pageStarted = performance.now()
      try {
        found = norm(await run(page.html, page.url, page.now))
      } catch {
        found = null
      }
      const pageMs = performance.now() - pageStarted
      judge(t, page.gold, found)
      if (values.jsonl) {
        rows.push(
          JSON.stringify({ tool: name, file: page.id, gold: page.gold, found, ms: Number(pageMs.toFixed(2)) }),
        )
      }
    }
    const ms = (performance.now() - started) / Math.max(1, pages.length)
    results.push({ name, ...t, ms })
  }

  // The per-page rows, not just the summary. A harness that printed only a table
  // would make every row in it unfalsifiable — the raw records are what someone
  // checking these results actually needs, and what lets the JS and Python halves
  // be tallied into one table by a command rather than by hand.
  if (values.jsonl) await writeFile(values.jsonl, rows.join('\n') + '\n')

  const header =
    '  tool                            exact  part  wrong  miss    TN   FP | precision  accuracy   ms/page'
  console.log(header)
  console.log(`  ${'-'.repeat(header.length - 2)}`)
  // Precision charges a false positive, accuracy credits a correct abstention.
  // Ranking on `exact + tn` rather than on `exact` is the same decision: a tool
  // that answers every undated page wrongly has not out-performed one that
  // declined, and sorting on exact alone would say it had.
  for (const r of results.sort((a, b) => b.exact + b.tn - (a.exact + a.tn))) {
    const answered = r.exact + r.partial + r.wrong + r.fp
    const pct = (n, d) => (d === 0 ? '    —  ' : `${((n / d) * 100).toFixed(1)}%`.padStart(7))
    console.log(
      `  ${r.name.padEnd(30)} ${String(r.exact).padStart(5)} ${String(r.partial).padStart(5)} ` +
        `${String(r.wrong).padStart(6)} ${String(r.missed).padStart(5)} ` +
        `${String(r.tn).padStart(5)} ${String(r.fp).padStart(4)} |  ${pct(r.exact, answered)}  ` +
        `${pct(r.exact + r.tn, pages.length)}   ${r.ms.toFixed(2).padStart(7)}`,
    )
  }
}

function readManifest(text) {
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

await main()
