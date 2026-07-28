/** Which Node HTML parser is fastest, and does it support what we need? */
import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '..', 'corpus-external', 'htmldate', 'cache')
const files = (await readdir(CACHE)).slice(0, 55)
const pages = await Promise.all(files.map((f) => readFile(join(CACHE, f), 'utf8')))

// The DOM surface pagedate actually uses.
const SELECTOR = 'p, span, div, li, time, abbr, a, h1, h2'
const probe = (doc) => {
  let n = 0
  for (const el of doc.querySelectorAll(SELECTOR)) {
    n += el.getAttribute?.('class') ? 1 : 0
    n += el.parentElement ? 1 : 0
    for (const child of el.childNodes ?? []) n += child.nodeType === 3 ? 1 : 0
  }
  // Attribute selector with ~=, used for feed discovery.
  n += doc.querySelectorAll('link[rel~="alternate"]').length
  return n
}

const parsers = {}

const { parseHTML } = await import('linkedom')
parsers.linkedom = (html) => parseHTML(html).document

try {
  const { Window } = await import('happy-dom')
  // A real URL is required: relative hrefs in the page are resolved against it,
  // and about:blank makes that throw.
  parsers['happy-dom'] = (html) => {
    const w = new Window({ url: 'https://example.com/' })
    w.document.documentElement.innerHTML = html
    return w.document
  }
} catch (e) { console.error('skip happy-dom', e.message) }

try {
  const { parse } = await import('node-html-parser')
  parsers['node-html-parser'] = (html) => parse(html)
} catch (e) { console.error('skip node-html-parser', e.message) }

for (const [name, parse] of Object.entries(parsers)) {
  // Warm-up
  try { for (const h of pages.slice(0, 5)) probe(parse(h)) } catch {}

  let parseMs = 0, probeMs = 0, ok = 0, failed = 0
  for (const html of pages) {
    try {
      let t = performance.now()
      const doc = parse(html)
      parseMs += performance.now() - t
      t = performance.now()
      probe(doc)
      probeMs += performance.now() - t
      ok++
    } catch { failed++ }
  }
  const n = pages.length
  console.log(
    `  ${name.padEnd(18)} parse ${(parseMs/n).toFixed(2).padStart(7)} ms  ` +
    `traverse ${(probeMs/n).toFixed(2).padStart(7)} ms  ` +
    `total ${((parseMs+probeMs)/n).toFixed(2).padStart(7)} ms  ok=${ok} failed=${failed}`
  )
}
