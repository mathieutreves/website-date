/**
 * What each mode costs and what it buys.
 *
 *   pnpm --filter pagedate build
 *   node packages/pagedate/scripts/modes.ts
 *
 * Speed without the matching accuracy number is a half-truth, so both are
 * reported together over the same corpus.
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

  const pages: Array<{ url: string; doc: Document; gold: string }> = []
  for (const [url, entry] of Object.entries(index)) {
    if (!cached.has(entry.file)) continue
    const { document } = parseHTML(await readFile(join(CACHE, entry.file), 'utf8'))
    pages.push({ url, doc: document as unknown as Document, gold: entry.date })
  }

  console.log(`\n${pages.length} pages\n`)
  console.log('  mode        ms/page   exact  partial  wrong  missed   accuracy')
  console.log(`  ${'-'.repeat(62)}`)

  for (const mode of ['fast', 'standard', 'extensive'] as Mode[]) {
    // Warm-up so JIT cost is not charged to the first mode measured.
    for (const page of pages) extractFromDocument(page.doc, page.url, { mode })

    let exact = 0
    let partial = 0
    let wrong = 0
    let missed = 0
    const started = performance.now()

    for (const page of pages) {
      const candidates = extractFromDocument(page.doc, page.url, { mode })
      const got = resolveCandidates(candidates, { now: NOW }).published?.value.slice(0, 10) ?? null

      if (got === null) missed++
      else if (got === page.gold) exact++
      else if (page.gold.startsWith(got)) partial++
      else wrong++
    }

    const ms = (performance.now() - started) / pages.length
    const accuracy = ((exact / pages.length) * 100).toFixed(1)

    console.log(
      `  ${mode.padEnd(10)} ${ms.toFixed(2).padStart(7)}  ${String(exact).padStart(6)}  ` +
        `${String(partial).padStart(7)}  ${String(wrong).padStart(5)}  ${String(missed).padStart(6)}  ` +
        `${accuracy.padStart(8)}%`,
    )
  }

  console.log(`
  Timings exclude HTML parsing, which an extension does not pay — the browser
  has already produced the DOM.
`)
}

await main()
