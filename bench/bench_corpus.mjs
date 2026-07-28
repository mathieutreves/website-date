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

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const MANIFEST = join(ROOT, 'corpus', 'manifest.jsonl')
const CACHE = join(ROOT, 'corpus', 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

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
  },
})

const splitOf = (host) =>
  createHash('sha1').update(host).digest()[0] % 3 === 0 ? 'test' : 'dev'

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
    tools[`pagedate (${mode})`] = (html, url) => {
      const document = parseHtml(html)
      const candidates = pagedate.extractFromDocument(document, url, { mode })
      return pagedate.resolveCandidates(candidates, { now: NOW }).published?.value ?? null
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

function judge(t, label, found) {
  if (found === null) return void t.missed++
  const width = Math.min(label.length, found.length)
  if (label.slice(0, width) !== found.slice(0, width)) return void t.wrong++
  if (found.length >= label.length) return void t.exact++
  return void t.partial++
}

async function main() {
  const all = readManifest(await readFile(MANIFEST, 'utf8'))
  let entries = all.filter((e) => e.fetch && e.label.published)
  if (values.split !== 'all') entries = entries.filter((e) => splitOf(e.strata.host) === values.split)
  entries = entries.filter((e) => e.captureLagDays <= Number(values['max-lag']))
  // Same exclusion score.ts makes: if the label is nowhere in the page, no tool
  // can find it and the entry measures nothing.
  entries = entries.filter((e) => e.strata.labelInPage !== false)
  if (values.limit) entries = entries.slice(0, Number(values.limit))

  const pages = []
  for (const entry of entries) {
    try {
      const html = await readFile(join(CACHE, `${entry.id}.html`), 'utf8')
      pages.push({
        html: values['raw-url'] ? html : neutraliseHtml(html),
        url: values['raw-url'] ? entry.url : neutralise(entry.url),
        gold: entry.label.published,
      })
    } catch {
      /* not fetched */
    }
  }

  const tools = await buildTools()
  console.log(
    `\n${pages.length} pages, split=${values.split}, ` +
      (values['raw-url']
        ? 'REAL URLs — circular, upper bound only\n'
        : 'URL neutralised for all tools\n'),
  )

  const results = []
  for (const [name, run] of Object.entries(tools)) {
    const t = { exact: 0, partial: 0, wrong: 0, missed: 0 }
    const started = performance.now()
    for (const page of pages) {
      let found = null
      try {
        found = norm(await run(page.html, page.url))
      } catch {
        found = null
      }
      judge(t, page.gold, found)
    }
    const ms = (performance.now() - started) / Math.max(1, pages.length)
    results.push({ name, ...t, ms })
  }

  const header =
    '  tool                            exact  part  wrong  miss | precision  accuracy   ms/page'
  console.log(header)
  console.log(`  ${'-'.repeat(header.length - 2)}`)
  for (const r of results.sort((a, b) => b.exact - a.exact)) {
    const answered = r.exact + r.partial + r.wrong
    const pct = (n, d) => (d === 0 ? '    —  ' : `${((n / d) * 100).toFixed(1)}%`.padStart(7))
    console.log(
      `  ${r.name.padEnd(30)} ${String(r.exact).padStart(5)} ${String(r.partial).padStart(5)} ` +
        `${String(r.wrong).padStart(6)} ${String(r.missed).padStart(5)} |  ${pct(r.exact, answered)}  ` +
        `${pct(r.exact, pages.length)}   ${r.ms.toFixed(2).padStart(7)}`,
    )
  }
}

function readManifest(text) {
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

await main()
