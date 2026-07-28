/**
 * Does `node-html-parser` give pagedate the same answers as linkedom?
 *
 *   node bench/parity.mjs                 # both corpora
 *   node bench/parity.mjs --corpus permalink
 *
 * This is a correctness check on a claim the project makes twice over, and the
 * two halves are easy to conflate:
 *
 *  - The shipped Node entry point parses with `node-html-parser`, chosen for
 *    being ~2.5x faster than linkedom.
 *  - Every test and every published benchmark figure is measured through
 *    linkedom, because that is what the harnesses use.
 *
 * So the numbers are produced by a parser the Node path does not use. That is
 * only acceptable while the two agree, and "a faster parser that silently sees
 * less of the page" is precisely the failure mode — an earlier measurement had
 * node-html-parser losing 14 of 55 pages, always by returning `null`, until the
 * extractors stopped assuming `parentElement` and `<script>` bodies were
 * preserved. This is the regression test for that.
 *
 * A difference here does not mean the parser is wrong; it means the published
 * accuracy figure does not describe the Node path, and one of the two has to
 * change.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parseHTML } from 'linkedom'
import { parse } from 'node-html-parser'
import { extractFromDocument, resolveCandidates } from '../packages/pagedate/dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const NOW = new Date('2026-01-01T00:00:00Z')

const { values } = parseArgs({
  options: { corpus: { type: 'string', default: 'both' } },
})

const run = (doc, url) => {
  try {
    const c = extractFromDocument(doc, url)
    const r = resolveCandidates(c, { now: NOW })
    return { date: r.published?.value.slice(0, 10) ?? null, n: c.length }
  } catch (e) {
    return { date: 'ERROR:' + e.message.slice(0, 40), n: -1 }
  }
}

/** The same options the shipped Node entry point passes. */
const asNodeHtml = (html) => parse(html, { blockTextElements: { script: true, style: true } })

async function loadHtmldate() {
  const dir = join(ROOT, 'corpus-external', 'htmldate')
  const index = JSON.parse(await readFile(join(dir, 'eval_default.json'), 'utf8'))
  const cached = new Set(await readdir(join(dir, 'cache')))
  const out = []
  for (const [url, entry] of Object.entries(index)) {
    if (!cached.has(entry.file)) continue
    out.push({ id: entry.file, url, path: join(dir, 'cache', entry.file) })
  }
  return out
}

async function loadPermalink() {
  const text = await readFile(join(ROOT, 'corpus', 'manifest.jsonl'), 'utf8')
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const e = JSON.parse(line)
    if (!e.fetch) continue
    out.push({ id: e.id, url: e.url, path: join(ROOT, 'corpus', 'cache', `${e.id}.html`) })
  }
  return out
}

async function compare(name, pages) {
  let same = 0
  let diff = 0
  let candDiff = 0
  const examples = []

  for (const page of pages) {
    let html
    try {
      html = await readFile(page.path, 'utf8')
    } catch {
      continue
    }

    const a = run(parseHTML(html).document, page.url)
    const b = run(asNodeHtml(html), page.url)

    if (a.date === b.date) same++
    else {
      diff++
      if (examples.length < 10) {
        examples.push(`    ${page.id}\n      linkedom=${a.date}  nhp=${b.date}\n      ${page.url.slice(0, 96)}`)
      }
    }
    if (a.n !== b.n) candDiff++
  }

  const total = same + diff
  console.log(`\n  ${name} — ${total} pages`)
  console.log(`    same answer            ${String(same).padStart(5)}`)
  console.log(`    DIFFERENT answer       ${String(diff).padStart(5)}`)
  // Not a failure on its own: the extractors deduplicate, so a parser can see a
  // different number of candidates and still resolve to the same date. Worth
  // printing because a rising count is an early warning that the two parsers are
  // drifting before it costs an answer.
  console.log(`    different #candidates  ${String(candDiff).padStart(5)}`)
  if (examples.length) console.log('\n' + examples.join('\n'))
  return diff
}

let differences = 0
if (values.corpus === 'both' || values.corpus === 'htmldate') {
  differences += await compare('htmldate corpus', await loadHtmldate().catch(() => []))
}
if (values.corpus === 'both' || values.corpus === 'permalink') {
  differences += await compare('permalink corpus', await loadPermalink().catch(() => []))
}

console.log(
  differences === 0
    ? `\n  Parsers agree. The published figures describe the Node path as well as the browser one.\n`
    : `\n  ${differences} disagreements. The published figures were measured through linkedom and\n` +
        `  do NOT describe the Node path until these are resolved.\n`,
)
process.exit(differences === 0 ? 0 : 1)
