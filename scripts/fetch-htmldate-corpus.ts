/**
 * Download htmldate's public evaluation corpus for direct comparison.
 *
 *   node scripts/fetch-htmldate-corpus.ts
 *
 * Fetches tests/eval_default.json (800 URLs → gold publication date) plus the
 * cached HTML for each, into corpus-external/htmldate/ — which is gitignored.
 * The pages are third-party HTML under no license we control, so they are
 * downloaded on demand and never committed.
 *
 * Resumable: files already present are skipped.
 *
 * Source: https://github.com/adbar/htmldate (code Apache-2.0 since v1.8.0)
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE = 'https://raw.githubusercontent.com/adbar/htmldate/master/tests'
const OUT = join(import.meta.dirname, '..', 'corpus-external', 'htmldate')
const CACHE = join(OUT, 'cache')
const CONCURRENCY = 8

type Entry = { file: string; date: string }

async function getText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'pagedate-eval/0.1' } })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  await mkdir(CACHE, { recursive: true })

  const indexPath = join(OUT, 'eval_default.json')
  let indexRaw: string | null = null
  try {
    indexRaw = await readFile(indexPath, 'utf8')
    console.log('index already present')
  } catch {
    console.log('fetching eval_default.json …')
    indexRaw = await getText(`${BASE}/eval_default.json`)
    if (!indexRaw) {
      console.error('could not fetch the index; aborting')
      process.exit(1)
    }
    await writeFile(indexPath, indexRaw)
  }

  const index = JSON.parse(indexRaw) as Record<string, Entry>
  const entries = Object.entries(index)
  console.log(`${entries.length} entries in the corpus`)

  const present = new Set(await readdir(CACHE).catch(() => []))
  const missing = entries.filter(([, e]) => !present.has(e.file))
  console.log(`${present.size} already cached, ${missing.length} to fetch`)

  let done = 0
  let failed = 0

  // Fixed-size worker pool: 800 simultaneous requests to raw.githubusercontent
  // would be both rude and rate-limited.
  const queue = missing.slice()
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const next = queue.pop()
      if (!next) return
      const [, entry] = next

      const html = await getText(`${BASE}/cache/${entry.file}`)
      if (html === null) {
        failed++
      } else {
        await writeFile(join(CACHE, entry.file), html)
      }

      done++
      if (done % 50 === 0) console.log(`  ${done}/${missing.length} …`)
    }
  })

  await Promise.all(workers)

  console.log(`\ndone: ${done - failed} fetched, ${failed} failed`)
  console.log(`corpus at corpus-external/htmldate/`)
  if (failed > 0) console.log('re-run to retry the failures (already-present files are skipped)')
}

await main()
