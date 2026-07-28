/**
 * Speed, measured three ways, because "faster" depends entirely on what you
 * count.
 *
 *   node packages/pagedate/scripts/speed-fair.ts
 *
 * The earlier leaderboard excluded HTML parsing for pagedate and included lxml
 * for htmldate, which flatters pagedate. This reports both, so the claim can be
 * made precisely or not at all.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'
import { extractFromDocument, resolveCandidates, type Mode } from '../dist/index.js'

const CORPUS = join(import.meta.dirname, '..', '..', '..', 'corpus-external', 'htmldate')
const CACHE = join(CORPUS, 'cache')
const NOW = new Date('2026-01-01T00:00:00Z')

async function main(): Promise<void> {
  const index = JSON.parse(await readFile(join(CORPUS, 'eval_default.json'), 'utf8')) as Record<
    string,
    { file: string; date: string }
  >
  const cached = new Set(await readdir(CACHE))

  const pages: Array<{ url: string; html: string }> = []
  for (const [url, entry] of Object.entries(index)) {
    if (!cached.has(entry.file)) continue
    pages.push({ url, html: await readFile(join(CACHE, entry.file), 'utf8') })
  }

  const prepared = pages.map((p) => {
    const { document } = parseHTML(p.html)
    return { ...p, doc: document as unknown as Document }
  })

  console.log(`\n${pages.length} pages\n`)

  for (const mode of ['fast', 'standard'] as Mode[]) {
    // Warm-up.
    for (const p of prepared) extractFromDocument(p.doc, p.url, { mode })

    let extractOnly = 0
    for (const p of prepared) {
      const t = performance.now()
      resolveCandidates(extractFromDocument(p.doc, p.url, { mode }), { now: NOW })
      extractOnly += performance.now() - t
    }

    let withParse = 0
    for (const p of pages) {
      const t = performance.now()
      const { document } = parseHTML(p.html)
      resolveCandidates(extractFromDocument(document as unknown as Document, p.url, { mode }), {
        now: NOW,
      })
      withParse += performance.now() - t
    }

    console.log(`  pagedate (${mode})`)
    console.log(`    extraction only          ${(extractOnly / pages.length).toFixed(2)} ms/page`)
    console.log(`    including HTML parsing   ${(withParse / pages.length).toFixed(2)} ms/page`)
  }

  console.log(`
  htmldate for comparison, both including lxml parsing:
    fast                      11.17 ms/page
    extensive                 75.53 ms/page

  Which number is the honest one depends on the caller:

  * In a browser extension, the DOM already exists and nothing pays for
    parsing. "Extraction only" is the real cost, and htmldate cannot run there
    at any speed.
  * In Node, a caller hands over HTML and pays for parsing. "Including HTML
    parsing" is the real cost, and linkedom is the dominant term — the
    comparison there is really linkedom vs lxml, not pagedate vs htmldate.
`)
}

await main()
