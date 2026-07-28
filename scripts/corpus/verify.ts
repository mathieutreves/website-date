/**
 * Check that the corpus on this machine is the corpus the numbers were measured
 * on.
 *
 *   node scripts/corpus/verify.ts
 *   node scripts/corpus/verify.ts --quiet     # exit code only
 *
 * `corpus/cache/` is gitignored — it is other people's HTML under no licence we
 * control — so anyone reproducing these results fetches it themselves from the
 * Wayback captures pinned in the manifest. That only means anything if the
 * result is provably identical, which is what `fetch.sha256` is for.
 *
 * This recomputes the digest of every cached file and compares. A mismatch is
 * not a warning to skim past: it means the page you are scoring is not the page
 * the published figure was measured on, and any comparison against it is void.
 *
 * Exit codes: 0 all present and matching, 1 drift, 2 nothing to verify.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { readManifest, type CorpusEntry } from './schema.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const MANIFEST = join(ROOT, 'corpus', 'manifest.jsonl')
const CACHE = join(ROOT, 'corpus', 'cache')

const { values } = parseArgs({ options: { quiet: { type: 'boolean', default: false } } })

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

async function main(): Promise<number> {
  let entries: CorpusEntry[]
  try {
    entries = readManifest(await readFile(MANIFEST, 'utf8'))
  } catch {
    console.error(`no manifest at ${MANIFEST} — run scripts/corpus/harvest.ts first`)
    return 2
  }

  const expected = entries.filter((e) => e.fetch?.sha256)
  if (expected.length === 0) {
    console.error('manifest records no fetched pages — run scripts/corpus/fetch.ts first')
    return 2
  }

  const missing: string[] = []
  const changed: Array<{ id: string; url: string }> = []
  let ok = 0

  for (const entry of expected) {
    let text: string
    try {
      text = await readFile(join(CACHE, `${entry.id}.html`), 'utf8')
    } catch {
      missing.push(entry.id)
      continue
    }
    if (sha256(text) === entry.fetch!.sha256) ok++
    else changed.push({ id: entry.id, url: entry.url })
  }

  if (!values.quiet) {
    console.log(`\ncorpus/manifest.jsonl — ${entries.length} entries, ${expected.length} fetched\n`)
    console.log(`  verified   ${String(ok).padStart(5)}`)
    console.log(`  missing    ${String(missing.length).padStart(5)}  (run scripts/corpus/fetch.ts)`)
    console.log(`  MISMATCHED ${String(changed.length).padStart(5)}`)

    for (const entry of changed.slice(0, 10)) {
      console.log(`    ${entry.id}  ${entry.url.slice(0, 90)}`)
    }
    if (changed.length > 10) console.log(`    … and ${changed.length - 10} more`)

    if (changed.length > 0) {
      console.log(
        `\n  A mismatch means the bytes on disk are not the bytes measured. Delete the\n` +
          `  affected files and re-run fetch.ts; if they still differ, the Wayback capture\n` +
          `  itself has changed and the manifest entry needs re-pinning.`,
      )
    } else if (missing.length === 0) {
      console.log(`\n  Corpus is byte-identical to the one the published figures were measured on.`)
    }
  }

  return changed.length > 0 ? 1 : 0
}

process.exit(await main())
