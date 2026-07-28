/**
 * Does node-html-parser give pagedate the same answers as linkedom?
 * A faster parser that silently sees less of the page is not faster.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHTML } from 'linkedom'
import { parse } from 'node-html-parser'
import { extractFromDocument, resolveCandidates } from '../packages/pagedate/dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = join(HERE, '..', 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

const index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8'))
const cached = new Set(await readdir(CACHE))

const run = (doc, url) => {
  try {
    const c = extractFromDocument(doc, url)
    const r = resolveCandidates(c, { now: NOW })
    return { date: r.published?.value.slice(0, 10) ?? null, n: c.length }
  } catch (e) { return { date: 'ERROR:' + e.message.slice(0, 40), n: -1 } }
}

let same = 0, diff = 0, candDiff = 0
const examples = []
for (const [url, entry] of Object.entries(index)) {
  if (!cached.has(entry.file)) continue
  const html = await readFile(join(CACHE, entry.file), 'utf8')

  const a = run(parseHTML(html).document, url)
  const b = run(parse(html, { blockTextElements: { script: true, style: true } }), url)

  if (a.date === b.date) same++
  else { diff++; if (examples.length < 8) examples.push(`    ${entry.file}\n      linkedom=${a.date}  nhp=${b.date}`) }
  if (a.n !== b.n) candDiff++
}
console.log(`\n  same answer:        ${same}`)
console.log(`  different answer:   ${diff}`)
console.log(`  different #candidates: ${candDiff}`)
if (examples.length) console.log('\n  examples:\n' + examples.join('\n'))
